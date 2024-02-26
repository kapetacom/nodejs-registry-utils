import * as Path from 'path';
import * as FS from 'fs';
import * as FSExtra from 'fs-extra';

import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { link } from './link';
import { RegistryService } from '../services/RegistryService';
import Config from '../config';
import { getVCSHandlerByType } from '../handlers/VCSHandler';
import { CloneCommandOptions, ProgressListener } from '../types';

export async function clone(
    progressListener: ProgressListener,
    uri: string,
    options: CloneCommandOptions,
): Promise<void> {
    const blockInfo = parseKapetaUri(uri);

    const registryService = new RegistryService(options.registry || Config.data.registry.url, blockInfo.handle);

    const registration = await registryService.getVersion(blockInfo.name, blockInfo.version);

    if (!registration) {
        throw new Error('Registration not found: ' + uri);
    }

    if (!registration.repository || !registration.repository.type) {
        throw new Error('Registration is missing version control information: ' + uri);
    }

    const handler = await getVCSHandlerByType(progressListener, registration.repository.type);

    if (!handler) {
        throw new Error('No version control handler found for type: ' + registration.repository.type);
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

    const checkoutId =
        blockInfo.version === 'current' ? registration.repository.branch : registration.repository.commit;

    const clonedPath = await handler.clone(registration.repository.details, checkoutId!, target);

    await progressListener.check('Asset source code was cloned', true);

    if (!options.skipLinking || blockInfo.version !== 'current') {
        await progressListener.progress<void>('Linking code to local repository', async () =>
            link(progressListener, clonedPath),
        );
    }
}
