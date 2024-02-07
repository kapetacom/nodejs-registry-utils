/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: MIT
 */

declare interface ProgressListener {
    progress: <T>(title: string, callback:() => Promise<T>) => Promise<T>;
    run: (cmd: string, cwd: string) => Promise<any>;
    check: (message:string, ok:boolean|Promise<boolean>) => Promise<void>

    start: (label:string) => void
    showValue: (label:string, value:string) => void

    error: (msg: string, ...args: string[]) => void;
    warn: (msg: string, ...args: string[]) => void;
    info: (msg: string, ...args: string[]) => void;
    debug: (msg: string, ...args: string[]) => void;

}

interface CommandOptions {
    registry: string
}

interface PullCommandOptions {
    registry: string
    nonInteractive: boolean
    target:string
}

interface InstallCommandOptions {
    registry?: string
    nonInteractive: boolean
    skipDependencies?: boolean
}

interface UninstallCommandOptions {
    nonInteractive: boolean
}

interface CloneCommandOptions {
    registry: string
    target: string
    nonInteractive: boolean
    skipLinking: boolean
}

interface PushCommandOptions {
    registry: string
    ignoreWorkingDirectory: boolean
    nonInteractive: boolean
    skipTests: boolean
    verbose: boolean
    skipInstall: boolean
    skipLinking: boolean
    dryRun:boolean
}

interface GitDetails {
    url: string
    remote: string
    branch: string
    path: string
}

interface DockerDetails {
    name:string
    primary:string
    tags:string[]
}

interface MavenDetails {
    groupId:string
    artifactId:string
    version:string
    registry:string
}

interface YAMLDetails {
    name:string
    version:string
}


interface NPMDetails {
    name:string
    version:string
    registry:string
}

interface ArtifactHandlerFactory {
    create(progressListener:ProgressListener, directory:string, accessToken?:string):ArtifactHandler;

    getType(): string

    isSupported(directory: string): Promise<boolean>
}

interface RegistryService {

}

interface ArtifactHandler<T extends any = any> {

    getName(): string

    verify(): Promise<void>

    calculateChecksum(): Promise<string>

    push(name:string, version:string, commit:string): Promise<Artifact<T>>

    pull(details:T, target:string, registryService:RegistryService):Promise<void>

    install(sourcePath:string, targetPath:string):Promise<void>

    build():Promise<void>;

    test():Promise<void>;
}

interface VCSHandler {
    getName(): string

    getType(): string

    isRepo(dirname: string): Promise<boolean>

    add(directory: string, filename: string): Promise<void>

    commit(directory: string, message: string): Promise<string>

    clone(checkoutInfo: any, checkoutId: string, targetFolder: string): Promise<string>

    push(directory: string, includeTags: boolean): Promise<void>

    pushTags(directory: string): Promise<void>

    tag(directory: string, tag: string): Promise<boolean>

    getLatestCommit(directory: string): Promise<string>

    getCommitsSince(directory, commitId): Promise<string[]>

    getBranch(directory: string): Promise<{branch:string,main:boolean}>

    getRemote(directory: string): Promise<string[]>

    getCheckoutInfo(directory: string): Promise<any>

    isWorkingDirectoryClean(directory: string): Promise<boolean>;

    isWorkingDirectoryUpToDate(directory: string): Promise<boolean>;
}

interface Artifact<T extends any = any> {
    // The type of the artifact. i.e. docker, npm, maven etc
    type: string;
    // Details about the artifact
    details: T
}


interface Repository<T extends any = any> {
    //The type of repository
    type: string

    // True if branch is main branch
    main: boolean

    // Commit is the commit hash of the repository from where the block was built.
    commit: string

    // Branch - depends on the type of version control
    branch: string

    // Type-specific details
    details: T

}

interface Reservation {
    id:string
    expires:number
    versions:ReservedVersion[]
}

interface ReservationRequest {
    mainBranch:boolean
    branchName:string
    minimumIncrement?:string
    assets:AssetDefinition[]
}

interface ReservedVersion {
    ownerId:string
    version:string
    content:AssetDefinition
    exists:boolean
}

interface AssetVersion<T extends any = any, U extends any = any> {
    version: string
    artifact: Artifact<T>
    repository: Repository<U>
    content: AssetDefinition
    checksum?: string
    dependencies: { name:string }[]
    current?: boolean
}

interface AssetDefinition {
    kind: string
    metadata: AssetMetaData
    spec: AssetSpec
}

interface AssetReference {
    name:string
    type:string
}

interface ReferenceMap {
    from:string
    to:string
}

type AssetSpec = any;

type APIResourceType = string | { $ref: string }

interface BlockEntityPropertyDefinition {
    type: string
}


interface BlockEntityDefinition {
    name: string
    properties: { [id: string]: BlockEntityPropertyDefinition }
}

interface BlockResourceDefinition {
    kind: string
    metadata: {
        name: string
    },
    spec: any
}


interface APIResourceMethodArgument {
    type: APIResourceType
    transport: string
    id: string
}

interface APIResourceMethod {
    description: string
    method: string
    path: string
    arguments: { [id: string]: APIResourceMethodArgument }
    responseType: APIResourceType
}

type APIResourceMethodMap = { [id: string]: APIResourceMethod }

interface AssetMetaData {
    name: string
}

interface ReserveOptions {
    /**
     * Disables automatic semantic versioning
     */
    disableAutoVersion: boolean

    /**
     * Disables checks for proper semantic versioning
     */
    skipVersionCheck: boolean

    /**
     * This tells the system how long to keep the reservation for until automatically aborting it
     */
    ttl: number
}

interface CommitOptions {

}

interface AbortOptions {

}

interface VersionInfo {
    patch: number
    major: number
    minor: number
    toMajorVersion: () => string
    toMinorVersion: () => string
    toFullVersion: () => string
    compare: (other: VersionInfo) => number
    toString: () => string
}

declare enum VersionDiffType {
    MAJOR = 'MAJOR',
    MINOR = 'MINOR',
    PATCH = 'PATCH',
    NONE = 'NONE'
}

type PromiseCallback = () => Promise<any>;
type PromiseOrCallback = Promise<any> | PromiseCallback;

type DataHandler = (data: any) => void;