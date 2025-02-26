// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

import { fromFileUrl, join } from "../../path/mod.ts";
import { delay } from "../../async/delay.ts";
import { assert } from "../../testing/asserts.ts";

const env = {
  DENO_NODE_COMPAT_URL: new URL("../../", import.meta.url).href,
};
const yarnUrl = new URL("./yarn.js", import.meta.url).href;

Deno.test("integration test of compat mode", {
  ignore: Deno.build.os === "windows",
}, async (t) => {
  const tempDir = await Deno.makeTempDir();
  const opts = { env, cwd: tempDir };
  const npmPath = join(tempDir, "node_modules", "npm");
  const yargsPath = join(tempDir, "node_modules", "yargs");
  const mysql2Path = join(tempDir, "node_modules", "mysql2");
  const expressPath = join(tempDir, "node_modules", "express");
  let hasDocker;
  try {
    await exec("docker help");
    hasDocker = true;
  } catch {
    hasDocker = false;
  }

  await t.step("Runs `yarn add <mod>`", async () => {
    await exec(`deno run --compat --unstable -A ${yarnUrl} add npm`, opts);
    assert((await Deno.lstat(join(npmPath, "package.json"))).isFile);
    await exec(`deno run --compat --unstable -A ${yarnUrl} add express`, opts);
    assert((await Deno.lstat(join(expressPath, "package.json"))).isFile);
    await exec(`deno run --compat --unstable -A ${yarnUrl} add mysql2`, opts);
    assert((await Deno.lstat(join(mysql2Path, "package.json"))).isFile);
  });

  await t.step("Runs `npm install <mod>`", async () => {
    const npmCli = join(npmPath, "index.js");
    await exec(`deno run --compat --unstable -A ${npmCli} install yargs`, opts);
    const stat = await Deno.lstat(join(yargsPath, "package.json"));
    assert(stat.isFile);
  });

  await t.step("run express example app", async () => {
    await Deno.writeTextFile(
      join(tempDir, "app.js"),
      `
    require("express")()
      .get("/", (req, res) => res.send("hello"))
      .listen(3000, async () => {
        const text = await (await fetch("http://localhost:3000")).text();
        if (text === "hello") {
          process.exit(0);
        } else {
          console.error(\`Error: Response text is not 'hello': $\{text}\`);
          process.exit(1);
        }
      });
    `,
    );
    await exec(`deno run --compat --unstable -A app.js`, opts);
  });

  // Runs test only when docker command is available
  if (hasDocker) {
    const pwd = fromFileUrl(new URL(".", import.meta.url));
    await exec(
      `docker run -d --name mysql-test -e MYSQL_ALLOW_EMPTY_PASSWORD=1 -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=test -v ${pwd}/testdata/mysql-conf:/etc/mysql/conf.d -v ${pwd}/testdata/mysql-certs:/certs -p 3306:3306 mysql:8.0.18`,
    );
    await t.step("Runs basic mysql2 example", async () => {
      await Deno.copyFile(
        fromFileUrl(new URL("mysql2-example.js", import.meta.url)),
        join(tempDir, "mysql2-example.js"),
      );
      // Wait for the mysql server starting
      // FIXME(kt3k): This is racy. Find a more reliable way to wait for
      // mysql being ready
      await delay(15000);
      await exec(`deno run --compat --unstable -A mysql2-example.js`, opts);
    });
    await exec("docker rm -f mysql-test");
  }

  await Deno.remove(tempDir, { recursive: true });
});

type Opts = Pick<Deno.SpawnOptions, "env" | "cwd">;
function exec(cmd: string, opts: Opts = {}) {
  const [command, ...args] = cmd.split(" ");
  return execCmd(command, args, opts);
}
async function execCmd(command: string, args: string[], opts: Opts) {
  console.log(`Executing the command: "${args.join(" ")}"`);
  const { code, stdout, stderr } = await Deno.spawn(command, {
    args,
    stdout: "piped",
    stderr: "piped",
    ...opts,
  });
  if (code !== 0) {
    console.log(new TextDecoder().decode(stdout));
    console.log(new TextDecoder().decode(stderr));
    throw new Error(`The command: "${args.join(" ")}" failed`);
  }
}
