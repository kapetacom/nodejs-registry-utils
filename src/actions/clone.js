/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

const Path = require('path');
const FS = require('fs');
const FSExtra = require('fs-extra');

const {parseKapetaUri} = require('@kapeta/nodejs-utils');

const link = require('./link');

const RegistryService = require("../services/RegistryService");
const VCSHandler = require("../handlers/VCSHandler");
const Config = require("../config");


/**
 *
 * @param {ProgressListener} progressListener
 * @param {string} uri
 * @param {CloneCommandOptions} options
 * @returns {Promise<void>}
 */
module.exports = async function clone(progressListener, uri, options) {
    const blockInfo = parseKapetaUri(uri);

    const registryService = new RegistryService(
        options.registry || Config.data.registry.url,
        blockInfo.handle
    );

    const registration = await registryService.getVersion(blockInfo.name, blockInfo.version);

    if (!registration) {
        throw new Error('Registration not found: ' + uri);
    }

    if (!registration.repository ||
        !registration.repository.type) {
        throw new Error('Registration is missing version control information: ' + uri);
    }

    const handler = await VCSHandler.getVCSHandlerByType(progressListener, registration.repository.type);

    if (!handler) {
        throw new Error('No version control handler found for type: ' + registration.vcs.type);
    }

    const target = options.target || Path.join(process.cwd(), registration.content.metadata.name);

    progressListener.start(`Clone repository to ${target}`);
    await progressListener.progress('Preparing for repository clone', async () => {
        const targetParent = Path.resolve(target, '../');

        if (FS.existsSync(targetParent)) {
            progressListener.debug(`Verified parent folder exists: ${targetParent}`);
        } else {
            progressListener.debug(`Creating parent folder: ${targetParent}`);
            FSExtra.mkdirpSync(targetParent);
        }
    });

    const checkoutId = (blockInfo.version === 'current') ?
        registration.repository.branch :
        registration.repository.commit

    const clonedPath = await handler.clone(registration.repository.details, checkoutId, target);

    await progressListener.check('Asset source code was cloned', true);

    if (!options.skipLinking ||
        blockInfo.version !== 'current') {
        await progressListener.progress('Linking code to local repository', () => link(progressListener, clonedPath));
    }
};
