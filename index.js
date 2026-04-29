const core = require("@actions/core");
const github = require("@actions/github");
const exec = require("@actions/exec");
const path = require("path");
const fs = require("fs");
const { DateTime, IANAZone } = require('luxon');
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
        await exec.exec("git", [
            "commit",
            "-m",
            "chore: update contribution stats [skip ci]",
        ], execOptions);

        await exec.exec("git", [
            "push",
            remoteUrl,
            `HEAD:${github.context.ref}`,
        ], execOptions);

        core.info("Changes pushed successfully.");
    } catch (error) {
        core.error(`Failed to push changes: ${error.message}`);
    }
}

async function run() {
    try {
        let username = core.getInput("username") || github.context.repo.owner;
        const theme = core.getInput("theme");
        const zone = core.getInput("zone");
        const outputPath = core.getInput("output_path");
        const isDryRun = core.getInput("dryrun") === "true";

        core.info(`Fetching data for ${username}...`);

        const response = await fetch(
            `https://github-contributions.vercel.app/api/v1/${username}`,
        );
        const data = await response.json();

        const iana = IANAZone.isValidZone(zone) ? IANAZone.create(zone) : IANAZone.create('Etc/UTC');

        const canvasEl = createCanvas(1000, 1000);
        drawContributions(canvasEl, {
            data: data,
            username: username,
            themeName: theme,
            footerText: `Last updated ${DateTime.now().setZone(iana).toFormat('dd MMMM yyyy HH:mm a')} (${iana.name}) with salty-sweet/render-contribs`,
        });

        const absolutePath = path.resolve(process.env.GITHUB_WORKSPACE, outputPath);
        const buffer = canvasEl.toBuffer("image/png");

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
