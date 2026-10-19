
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// returns true if the passsed file is being invoked from node,
// not imported. `node -e` / stdin runs have no argv[1]: nothing is main.
/** @param {string} importMetaUrl @returns {boolean} */
export function isMain(importMetaUrl) {
    const entry = process.argv[1];
    // Node normally resolves module symlinks but leaves the CLI entry path intact.
    return entry !== undefined && existsSync(entry)
        && realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(entry);
}
