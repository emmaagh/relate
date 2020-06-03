import fse from 'fs-extra';
import got from 'got';
import path from 'path';
import hasha from 'hasha';

import {FetchError, NotFoundError, IntegrityError} from '../../../errors';
import {extractExtension} from './extract-extension';
import {EXTENSION_URL_PATH, EXTENSION_SHA_ALGORITHM, HOOK_EVENTS} from '../../../constants';
import {discoverExtension, IExtensionMeta} from './extension-versions';
import {JFROG_PRIVATE_REGISTRY_PASSWORD, JFROG_PRIVATE_REGISTRY_USERNAME} from '../../environment.constants';
import {download, emitHookEvent} from '../../../utils';

export interface IExtensionRegistryManifest {
    name: string;
    'dist-tags': {
        [latest: string]: string;
    };
    versions: {
        [version: string]: {
            name: string;
            version: string;
            dist: {
                tarball: string;
                shasum: string;
            };
        };
    };
}

export interface IFetchExtensionInfo {
    tarball: string;
    shasum: string;
}

const fetchExtensionInfo = async (extensionName: string, version: string): Promise<IFetchExtensionInfo> => {
    let res: IExtensionRegistryManifest;
    try {
        res = await got(`${EXTENSION_URL_PATH}${extensionName}`, {
            // @todo: handle env vars
            password: JFROG_PRIVATE_REGISTRY_PASSWORD,
            username: JFROG_PRIVATE_REGISTRY_USERNAME,
        }).json();
    } catch (error) {
        throw new FetchError(`Invalid response from "${EXTENSION_URL_PATH}${extensionName}"`);
    }

    if (!res.versions[version]) {
        throw new NotFoundError(`Unable to find the requested version: ${version} online`);
    }

    const {
        dist: {tarball, shasum},
    } = res.versions[version];

    return {
        shasum,
        tarball,
    };
};

const verifyHash = async (
    expectedShasumHash: string,
    pathToFile: string,
    algorithm = EXTENSION_SHA_ALGORITHM,
): Promise<string> => {
    const hash = await hasha.fromFile(pathToFile, {algorithm});
    if (hash !== expectedShasumHash) {
        // @todo maybe not?
        // remove tmp output
        await fse.remove(pathToFile);
        throw new IntegrityError('Expected hash mismatch');
    }
    return hash;
};

export const downloadExtension = async (
    name: string,
    version: string,
    extensionDistributionsPath: string,
): Promise<IExtensionMeta> => {
    const {tarball, shasum} = await fetchExtensionInfo(name, version);

    await emitHookEvent(HOOK_EVENTS.RELATE_EXTENSION_DOWNLOAD_START, null);
    const downloadFilePath = await download(tarball, extensionDistributionsPath, {
        password: JFROG_PRIVATE_REGISTRY_PASSWORD,
        username: JFROG_PRIVATE_REGISTRY_USERNAME,
    });
    await emitHookEvent(HOOK_EVENTS.RELATE_EXTENSION_DOWNLOAD_STOP, null);

    await verifyHash(shasum, downloadFilePath);

    // extract extension to cache dir first
    const extractPath = path.join(extensionDistributionsPath, `${name}@${version}.tmp`);
    const {name: extensionName, dist, version: extensionVersion} = await extractExtension(
        downloadFilePath,
        extractPath,
    );
    const destinationPath = path.join(extensionDistributionsPath, `${extensionName}@${extensionVersion}`);

    // move the extracted dir and remove the downloaded archive
    await emitHookEvent(HOOK_EVENTS.RELATE_EXTENSION_DIRECTORY_MOVE_START, `moving ${name} to data directory`);
    await fse.move(dist, destinationPath, {overwrite: true});
    await fse.remove(extractPath);
    await fse.remove(downloadFilePath);
    await emitHookEvent(HOOK_EVENTS.RELATE_EXTENSION_DIRECTORY_MOVE_STOP, null);

    return discoverExtension(destinationPath);
};
