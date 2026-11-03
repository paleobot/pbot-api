const fs = require("fs");
const os = require("os");
const path = require("path");

// pbot-api runs on the newest nvm-installed Node matching the major version in
// .nvmrc, so this file never pins a patch version. PM2 resolves this only at
// `pm2 start`; after installing a newer Node, `pm2 delete pbot-api && pm2 start
// ecosystem.config.cjs --only pbot-api`. index.js refuses to boot on Node < 26.12.1.
const apiNode = () => {
  const major = fs.readFileSync(path.join(__dirname, ".nvmrc"), "utf8").trim().replace(/^v/, "");
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
    interpreter: apiNode(),
    watch: true
  }, {
    name   : "pbot-client",
    script : "./node_modules/react-scripts/scripts/start.js",
    cwd: "./client",
    interpreter: "/home/doug/.nvm/versions/node/v16.17.0/bin/node",
    watch: true
  }]
}
