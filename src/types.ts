/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */
import { RegistryService } from './services/RegistryService';
import { Attachment } from '@kapeta/schemas';

export interface ProgressListener {
    progress<T = any>(title: string, callback: () => Promise<T>): Promise<T> | T;
    run(cmd: string, cwd?: string): Promise<any> | any;
    check(message: string, ok: boolean | Promise<boolean>): Promise<boolean> | boolean;

    start(label: string): void;
    showValue(label: string, value: string): void;

    error(msg: string, ...args: string[]): void;
    warn(msg: string, ...args: string[]): void;
    info(msg: string, ...args: string[]): void;
    debug(msg: string, ...args: string[]): void;
}

export interface ReadmeData {
    type: string;
    content: string;
}

export interface CommandOptions {
    registry: string;
}

export interface PullCommandOptions {
    registry: string;
    interactive: boolean;
    target: string;
}

export interface InstallCommandOptions {
    registry?: string;
    interactive: boolean;
    skipDependencies?: boolean;
}

export interface UninstallCommandOptions {
    interactive: boolean;
}

export interface CloneCommandOptions {
    registry: string;
    target: string;
    interactive: boolean;
    skipLinking: boolean;
}

export interface PushCommandOptions {
    registry: string;
    ignoreWorkingDirectory: boolean;
    interactive: boolean;
    skipTests: boolean;
    verbose: boolean;
    skipInstall: boolean;
    skipLinking: boolean;
    dryRun: boolean;
}

export interface GitDetails {
    url: string;
    remote: string;
    branch: string;
    path: string;
}

export interface DockerDetails {
    name: string;
    primary: string;
    tags: string[];
}

export interface MavenDetails {
    groupId: string;
    artifactId: string;
    version: string;
    registry: string;
}

export interface YAMLDetails {
    name: string;
    version: string;
}

export interface NPMDetails {
    name: string;
    version: string;
    registry: string;
}

export interface ArtifactHandlerFactory {
    create(progressListener: ProgressListener, directory: string, accessToken?: string): ArtifactHandler;

    getType(): string;

    isSupported(directory: string): Promise<boolean> | boolean;
}

export interface ArtifactHandler<T extends any = any> {
    getName(): string;

    verify(): Promise<void>;

    calculateChecksum(): Promise<string>;

    push(name: string, version: string, commit: string): Promise<Artifact<T>>;

    pull(details: T, target: string, registryService: RegistryService): Promise<void>;

    install(sourcePath: string, targetPath: string): Promise<void>;

    build(): Promise<void>;

    test(): Promise<void>;
}

export interface VCSHandlerFactory {
    create(progressListener: ProgressListener): VCSHandler;

    isRepo(directory: string): Promise<boolean> | boolean;

    getType(): string;
}

export interface VCSHandler {
    getName(): string;

    getType(): string;

    isRepo(dirname: string): Promise<boolean>;

    add(directory: string, filename: string): Promise<void>;

    commit(directory: string, message: string): Promise<string | null>;

    clone(checkoutInfo: any, checkoutId: string, targetFolder: string): Promise<string>;

    push(directory: string, includeTags: boolean): Promise<void>;

    pushTags(directory: string): Promise<void>;

    tag(directory: string, tag: string): Promise<boolean>;

    getLatestCommit(directory: string): Promise<string | null>;

    getCommitsSince(directory: string, commitId: string): Promise<string[]>;

    getBranch(directory: string): Promise<{ branch: string; main: boolean }>;

    getRemote(directory: string): Promise<string[]>;

    getCheckoutInfo(directory: string): Promise<any>;

    isWorkingDirectoryClean(directory: string): Promise<boolean>;

    isWorkingDirectoryUpToDate(directory: string): Promise<boolean>;
}

export interface Artifact<T extends any = any> {
    // The type of the artifact. i.e. docker, npm, maven etc
    type: string;
    // Details about the artifact
    details: T;
}

export interface Repository<T extends any = any> {
    //The type of repository
    type: string;

    // True if branch is main branch
    main: boolean;

    // Commit is the commit hash of the repository from where the block was built.
    commit: string | null;

    // Branch - depends on the type of version control
    branch: string;

    // Type-specific details
    details: T;
}

export interface Reservation {
    id: string;
    expires: number;
    versions: ReservedVersion[];
}

export interface ReservationRequest {
    mainBranch: boolean;
    branchName: string;
    commit: string | null;
    checksum: string | null;
    minimumIncrement?: string;
    assets: AssetDefinition[];
}

export interface ReservedVersion {
    ownerId: string;
    version: string;
    content: AssetDefinition;
    exists: boolean;
}

export interface AssetVersion<T extends any = any, U extends any = any> {
    version: string;
    artifact?: Artifact<T> | null;
    repository?: Repository<U>;
    content: AssetDefinition;
    checksum?: string;
    dependencies?: { name: string }[];
    current?: boolean;
    readme?: ReadmeData | null;
}

export interface AssetDefinition {
    kind: string;
    metadata: AssetMetaData;
    spec: AssetSpec;
    attachments?: Attachment[];
}

export interface AssetReference {
    name: string;
    type: string;
}

export interface ReferenceMap {
    from: string;
    to: string;
}

export type AssetSpec = any;

export type APIResourceType = string | { $ref: string };

export interface BlockEntityPropertyDefinition {
    type: string;
}

export interface BlockEntityDefinition {
    name: string;
    properties: { [id: string]: BlockEntityPropertyDefinition };
}

export interface BlockResourceDefinition {
    kind: string;
    metadata: {
        name: string;
    };
    spec: any;
}

export interface APIResourceMethodArgument {
    type: APIResourceType;
    transport: string;
    id: string;
}

export interface APIResourceMethod {
    description: string;
    method: string;
    path: string;
    arguments: { [id: string]: APIResourceMethodArgument };
    responseType: APIResourceType;
}

export type APIResourceMethodMap = { [id: string]: APIResourceMethod };

export interface AssetMetaData {
    name: string;
}

export interface ReserveOptions {
    /**
     * Disables automatic semantic versioning
     */
    disableAutoVersion: boolean;

    /**
     * Disables checks for proper semantic versioning
     */
    skipVersionCheck: boolean;

    /**
     * This tells the system how long to keep the reservation for until automatically aborting it
     */
    ttl: number;
}

export interface CommitOptions {}

export interface AbortOptions {}

export interface VersionInfo {
    patch: number;
    major: number;
    minor: number;
    toMajorVersion: () => string;
    toMinorVersion: () => string;
    toFullVersion: () => string;
    compare: (other: VersionInfo) => number;
    toString: () => string;
}

export enum VersionDiffType {
    MAJOR = 'MAJOR',
    MINOR = 'MINOR',
    PATCH = 'PATCH',
    NONE = 'NONE',
}

export type PromiseCallback = () => Promise<any>;
export type PromiseOrCallback = Promise<any> | PromiseCallback;

export type DataHandler = (data: any) => void;
