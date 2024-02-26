import * as FS from 'node:fs';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import * as FSExtra from 'fs-extra';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { ProgressListener } from '../types';

export async function uninstall(progressListener: ProgressListener, uris: string[]): Promise<void> {
    progressListener.start('Removing assets');

    for (let i = 0; i < uris.length; i++) {
        const uri: string = uris[i];
        const blockInfo = parseKapetaUri(uri);
        const path: string = ClusterConfiguration.getRepositoryAssetPath(
            blockInfo.handle,
            blockInfo.name,
            blockInfo.version,
        );

        if (!FS.existsSync(path)) {
            await progressListener.check(`Asset not installed: ${uri}`, false);
            continue;
        }

        //TODO: Remove all assets that depend on this asset
        FSExtra.removeSync(path);

        await progressListener.check(`Removed asset: ${uri}`, true);
    }
}
