import { PushOperation } from './PushOperation';
import { link } from './link';
import { install } from './install';
import { ProgressListener, PushCommandOptions } from '../types';

export const push = async (
    progressListener: ProgressListener,
    path: string = process.cwd(),
    options: PushCommandOptions,
): Promise<void> => {
    const operation = new PushOperation(progressListener, path, options);
    progressListener.start(`Push ${operation.file}`);
    try {
        if (!options.skipLinking && !options.dryRun) {
            await progressListener.progress('Linking local version', async () => link(progressListener, path));
        }

        const { references, mainBranch } = await operation.perform();

        if (mainBranch && !options.skipInstall && !options.dryRun && references.length > 0) {
            await progressListener.progress('Installing new versions', () =>
                install(progressListener, references, {
                    registry: options.registry,
                    skipDependencies: true,
                }),
            );
        }
    } catch (err: any) {
        progressListener.error('Push failed');

        if (options.verbose && err.stack) {
            progressListener.error(err.stack);
        }
        throw err;
    }
};
