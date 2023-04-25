const install = require('./install');
const link = require('./link');

const {PushOperation} = require("./PushOperation");





/**
 *
 * @param {ProgressListener} progressListener
 * @param {string} [path=process.cwd()]
 * @param {PushCommandOptions} options
 * @returns {Promise<void>}
 */
module.exports = async function push(progressListener, path, options) {

    if (!path) {
        path = process.cwd();
    }

    const operation = new PushOperation(progressListener, path, options);
    progressListener.start(`Push ${operation.file}`);
    try {

        if (!options.skipLinking && !options.dryRun) {
            await progressListener.progress('Linking local version', () => link(progressListener, path));
        }

        const {references,mainBranch} = await operation.perform();

        if (mainBranch &&
            !options.skipInstall &&
            !options.dryRun &&
            references.length > 0) {
            //We install assets once we've pushed them.
            await progressListener.progress('Installing new versions', () => install(progressListener, references, {
                nonInteractive: options.nonInteractive,
                registry: options.registry,
                skipDependencies: true
            }));
        }

    } catch (err) {
        progressListener.error('Push failed');

        if (options.verbose && err.stack) {
            progressListener.error(err.stack);
        }
        throw err;
    }

};
