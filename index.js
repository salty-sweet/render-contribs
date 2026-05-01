const core = require("@actions/core");
const github = require("@actions/github");
const exec = require("@actions/exec");
const path = require("path");
const fs = require("fs");
const { DateTime, IANAZone } = require("luxon");
const { createCanvas } = require("canvas");
const { drawContributions } = require("github-contributions-canvas");

async function commitAndPush(outputPath) {
    const token = core.getInput("github_token", { required: true });
    const repo = github.context.repo;

    const execOptions = { cwd: process.env.GITHUB_WORKSPACE };

    await exec.exec("git", [
        "config",
        "--global",
        "user.name",
        "github-actions[bot]",
    ]);
    await exec.exec("git", [
        "config",
        "--global",
        "user.email",
        "41898282+github-actions[bot]@users.noreply.github.com",
    ]);

    const remoteUrl = `https://x-access-token:${token}@github.com/${repo.owner}/${repo.repo}.git`;

    await exec.exec("git", ["add", outputPath], execOptions);

    try {
        await exec.exec(
            "git",
            ["commit", "-m", "chore: update contribution stats [skip ci]"],
            execOptions,
        );

        await exec.exec(
            "git",
            ["push", remoteUrl, `HEAD:${github.context.ref}`],
            execOptions,
        );

        core.info("Changes pushed successfully.");
    } catch (error) {
        core.error(`Failed to push changes: ${error.message}`);
    }
}

async function collectContributions(targetUser) {
    const token = core.getInput("github_token", { required: true });
    const octokit = github.getOctokit(token);

    const userBaseInfo = await octokit.graphql(
        `
      query($userName: String!) {
        user(login: $userName) { createdAt }
      }
    `,
        { userName: targetUser },
    );
    const startYear = new Date(userBaseInfo.user.createdAt).getFullYear();
    const currentYear = new Date().getFullYear();

    core.info(
        `Identified ${targetUser}'s account creation date being ${userBaseInfo.user.createdAt}`,
    );

    const output = {
        years: [],
        contributions: [],
    };

    const contribIntensity = {
        NONE: "0",
        FIRST_QUARTILE: "1",
        SECOND_QUARTILE: "2",
        THIRD_QUARTILE: "3",
        FOURTH_QUARTILE: "4",
    };

    for (let year = currentYear; year >= startYear; year--) {
        core.info(`Processing ${year}...`);

        const from = `${year}-01-01T00:00:00Z`;
        const to = `${year}-12-31T23:59:59Z`;

        const response = await octokit.graphql(
            `
            query($userName: String!, $from: DateTime, $to: DateTime) {
              user(login: $userName) {
                contributionsCollection(from: $from, to: $to) {
                  contributionCalendar {
                    totalContributions
                    weeks {
                      contributionDays {
                        date
                        contributionCount
                        contributionLevel
                        color
                      }
                    }
                  }
                }
              }
            }
          `,
            { userName: targetUser, from, to },
        );

        const calendar =
            response.user.contributionsCollection.contributionCalendar;
        const allDays = calendar.weeks.flatMap((w) => w.contributionDays);

        // Add to years summary
        output.years.push({
            year: year.toString(),
            total: calendar.totalContributions,
            range: {
                start: allDays[0].date,
                end: allDays[allDays.length - 1].date,
            },
        });

        const mappedDays = allDays.map((day) => ({
            date: day.date,
            count: day.contributionCount,
            color: day.color,
            intensity: contribIntensity[day.contributionLevel] || "0",
        }));

        output.contributions.push(...mappedDays);
    }
    output.contributions.sort((a, b) => new Date(b.date) - new Date(a.date));

    return output;
}

async function run() {
    try {
        let username = core.getInput("username") || github.context.repo.owner;
        const theme = core.getInput("theme");
        const zone = core.getInput("zone");
        const outputPath = core.getInput("output_path");
        const isDryRun = core.getInput("dryrun") === "true";
        const custom_theme = core.getInput("custom_theme") === 'null' ? null : core.getInput("custom_theme");
        const parsedTheme = JSON.parse(custom_theme) || null;

        core.info(`Fetching data for ${username}...`);

        const data = await collectContributions(username);

        const iana = IANAZone.isValidZone(zone)
            ? IANAZone.create(zone)
            : IANAZone.create("Etc/UTC");

        const canvasEl = createCanvas(1000, 1000);
        const options = {
            data: data,
            username: username,
            footerText: `Last updated ${DateTime.now().setZone(iana).toFormat("dd MMMM yyyy HH:mm a")} (${iana.name}) with salty-sweet/render-contribs`,
        };

        if (theme) options.themeName = theme;
        if (custom_theme) options.customTheme = parsedTheme;

        drawContributions(canvasEl, options);
        const buffer = canvasEl.toBuffer("image/png");

        const absolutePath = path.resolve(
            process.env.GITHUB_WORKSPACE,
            outputPath,
        );
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(absolutePath, buffer);
        core.info(`Image saved to ${absolutePath}`);

        if (!isDryRun) {
            await commitAndPush(outputPath);
        } else {
            core.info("Dry run enabled. Skipping git commit.");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();