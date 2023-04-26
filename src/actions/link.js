const YAML = require('yaml');
const Path = require("node:path");
const FS = require("node:fs");
const FSExtra = require('fs-extra');
const ClusterConfiguration = require('@kapeta/local-cluster-config');


function makeSymLink(directory, versionTarget) {
    try {
        // use lstat to check if there is an existing symlink
        // throws if nothing is there, but returns file stats even for invalid links
        // we can't rely on fs.exists, since invalid symlinks return false
        if (FS.lstatSync(versionTarget)) {
            FSExtra.removeSync(versionTarget);
        }
    } catch(e) {};
    FSExtra.mkdirpSync(Path.dirname(versionTarget));
    FSExtra.createSymlinkSync(directory, versionTarget);
}

/**
 *
 * @param {ProgressListener} progressListener
 * @param {string} [source=process.cwd()]
 * @returns {Promise<void>}
 */
module.exports = async function link(progressListener, source) {
    const resolvedPath = Path.resolve(source || process.cwd());

    const kapetaYmlFilePath = Path.join(resolvedPath, 'kapeta.yml');
    if (!FS.existsSync(kapetaYmlFilePath)) {
        throw new Error('Current working directory is not a valid kapeta asset. Expected a kapeta.yml file');
    }

    const assetInfos = YAML.parseAllDocuments(FS.readFileSync(kapetaYmlFilePath).toString())
        .map(doc => doc.toJSON());

    //If there are multiple assets in the kapeta.yml - we still just create 1 symlink since both will
    //otherwise be loaded twice
    const assetInfo = assetInfos[0];
    const [handle, name] = assetInfo.metadata.name.split('/');
    const target = ClusterConfiguration.getRepositoryAssetPath(handle, name, 'local');
    makeSymLink(resolvedPath, target);

    assetInfos.forEach(blockInfo => {
        progressListener.info('Linked asset %s:local\n  %s --> %s', blockInfo.metadata.name, resolvedPath, target);
    })

    await progressListener.check('Linking done', true);

};
