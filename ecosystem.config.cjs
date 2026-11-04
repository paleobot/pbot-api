const fs = require("fs");
const os = require("os");
const path = require("path");

// Each app runs on the newest nvm-installed Node matching the major version in
// its own .nvmrc (pbot-api: ./.nvmrc, pbot-client: ./client/.nvmrc), so this
// file never pins a patch version. PM2 resolves the interpreter only at
// `pm2 start`; after installing a newer Node or changing an .nvmrc,
// `pm2 delete <app> && pm2 start ecosystem.config.cjs --only <app>`.
// PM2 evaluates this whole file even with --only, so a missing .nvmrc or Node
// major for either app stops both from starting. index.js refuses to boot on
// Node < 26.12.1. See NODE-RUNTIME.md.
const nvmNode = (dir) => {
  const nvmrc = path.join(dir, ".nvmrc");
  if (!fs.existsSync(nvmrc)) throw new Error(`No .nvmrc at ${nvmrc}; cannot choose a Node version`);
  const major = fs.readFileSync(nvmrc, "utf8").trim().replace(/^v/, "");
  const nodeDir = path.join(os.homedir(), ".nvm", "versions", "node");
  const parse = (v) => v.slice(1).split(".").map(Number);
  const newest = fs.readdirSync(nodeDir)
    .filter((v) => v.startsWith(`v${major}.`))
    .sort((a, b) => {
      const [x, y] = [parse(a), parse(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    })
    .pop();
  if (!newest) throw new Error(`No nvm-installed Node ${major}.x in ${nodeDir}; run \`nvm install ${major}\``);
  return path.join(nodeDir, newest, "bin", "node");
};

module.exports = {
  apps : [{
    name   : "pbot-api",
    script : "./index.js",
    cwd: ".",
    interpreter: nvmNode(__dirname),
    watch: true
  }, {
    // Dev host only (prod serves the static build via nginx). Runs through
    // CRACO so dev gets the same webpack polyfills as `npm start` and the prod
    // build. watch is off: webpack recompiles src/ changes itself; dependency
    // changes need `npm ci` + `pm2 restart pbot-client`.
    name   : "pbot-client",
    script : "./node_modules/@craco/craco/dist/bin/craco.js",
    args: "start",
    cwd: "./client",
    interpreter: nvmNode(path.join(__dirname, "client")),
    watch: false
  }]
}
