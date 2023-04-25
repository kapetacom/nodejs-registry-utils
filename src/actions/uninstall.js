const FS = require('node:fs');
const {parseKapetaUri} = require('@kapeta/nodejs-utils');

const FSExtra = require('fs-extra');
const ClusterConfiguration = require('@kapeta/local-cluster-config');

/**
 *
 * @param {ProgressListener} progressListener
 * @param {string[]} uris
 * @returns {Promise<void>}
 */
module.exports = async function uninstall(progressListener, uris) {
    progressListener.start('Removing assets');

    for (let i = 0; i < uris.length; i++) {
        const uri = uris[i];
        const blockInfo = parseKapetaUri(uri);
        const path = ClusterConfiguration.getRepositoryAssetPath(blockInfo.handle, blockInfo.name, blockInfo.version);

        if (!FS.existsSync(path)) {
            await progressListener.check(`Asset not installed: ${uri}`, false);
            continue;
        }

        //TODO: Remove all assets that depend on this asset
        FSExtra.removeSync(path, {recursive: true});

        await progressListener.check(`Removed asset: ${uri}`, true);
    }

};
