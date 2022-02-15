module.exports = {
  apps : [{
    name   : "pbot-api",
    script : "./index.js",
    cwd: ".",
    interpreter: "/home/doug/.nvm/versions/node/v14.19.0/bin/node",
    watch: true
  }, {
    name   : "pbot-client",
    script : "./node_modules/react-scripts/scripts/start.js",
    cwd: "./client",
    interpreter: "/home/doug/.nvm/versions/node/v14.19.0/bin/node",
    watch: true
  }]
}
