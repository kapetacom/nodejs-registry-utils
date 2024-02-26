import { ProgressListener, VCSHandler, VCSHandlerFactory } from '../types';
import { GitHandler } from './vcs-handlers/GitHandler';

const VCS_HANDLERS: VCSHandlerFactory[] = [GitHandler];

export const getVCSHandler = async (
    progressListener: ProgressListener,
    directory: string,
): Promise<VCSHandler | null> => {
    for (let i = 0; i < VCS_HANDLERS.length; i++) {
        const handler = VCS_HANDLERS[i];
        if (await handler.isRepo(directory)) {
            return handler.create(progressListener);
        }
    }

    return null;
};

export const getVCSHandlerByType = async (
    progressListener: ProgressListener,
    type: string,
): Promise<VCSHandler | null> => {
    for (let i = 0; i < VCS_HANDLERS.length; i++) {
        const handler = VCS_HANDLERS[i];
        if (handler.getType().toLowerCase() === type.toLowerCase()) {
            return handler.create(progressListener);
        }
    }

    return null;
};
