//Refuse to start on a Node.js runtime that is not patched against
//CVE-2026-111497 (Brotli decoder out-of-bounds write). Imported first by
//index.js so it runs before the rest of the application is evaluated.
//Checks the Node version, not process.versions.brotli: patched 26.13.0 still
//reports Brotli 1.2.0.
const MIN_NODE = [26, 12, 1];

const running = process.versions.node.split('.').map(Number);

const isOlder = (a, b) => {
    for (let i = 0; i < b.length; i++) {
        if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i];
    }
    return false;
};

if (isOlder(running, MIN_NODE)) {
    console.error(
        `pbot-api requires Node.js >= ${MIN_NODE.join('.')} ` +
        `(CVE-2026-111497); running ${process.versions.node}. Refusing to start.`
    );
    process.exit(1);
}
