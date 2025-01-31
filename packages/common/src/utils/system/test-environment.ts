import {INestApplicationContext, Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {NestFactory} from '@nestjs/core';
import {Dict} from '@relate/types';
import fse from 'fs-extra';
import path from 'path';
import {v4 as uuid} from 'uuid';

import {ENVIRONMENT_TYPES, LocalEnvironment, NEO4J_EDITION} from '../../entities/environments';
import {NotSupportedError} from '../../errors';
import {IDbmsInfo} from '../../models';
import {SystemModule, SystemProvider} from '../../system';

export const TEST_NEO4J_VERSION = process.env.TEST_NEO4J_VERSION || '4.0.12';
export const TEST_NEO4J_EDITION: NEO4J_EDITION = Dict.from(NEO4J_EDITION)
    .values.find((e) => e === process.env.TEST_NEO4J_EDITION)
    .getOrElse(NEO4J_EDITION.ENTERPRISE);
export const TEST_NEO4J_CREDENTIALS = 'password';

export class TestEnvironment {
    constructor(
        public readonly filename: string,
        public readonly app: INestApplicationContext,
        public readonly systemProvider: SystemProvider,
        public readonly environment: LocalEnvironment,
    ) {
        if (process.env.NODE_ENV !== 'test') {
            throw new NotSupportedError('Cannot use TestEnvironment outside of testing environment');
        }
    }

    static async init(filename: string): Promise<TestEnvironment> {
        const shortUUID = uuid().slice(0, 8);
        const dirname = path.basename(path.dirname(filename));
        const name = `${dirname}_${path.basename(filename, '.ts')}_${shortUUID}`;

        @Module({
            imports: [
                ConfigModule.forRoot({
                    isGlobal: true,
                }),
                SystemModule.register(),
            ],
        })
        class AppModule {}

        const app = await NestFactory.createApplicationContext(AppModule);

        const systemProvider = app.get(SystemProvider);
        await systemProvider.createEnvironment({
            name,
            type: ENVIRONMENT_TYPES.LOCAL,
        });

        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        const environment: LocalEnvironment = await systemProvider.getEnvironment(name);

        // eslint-disable-next-line no-restricted-syntax
        return new TestEnvironment(filename, app, systemProvider, environment);
    }

    async teardown(): Promise<void> {
        const dbmss = await this.environment.dbmss.list();
        const dbmsIds = dbmss.mapEach((dbms) => dbms.id);

        await this.environment.dbmss.stop(dbmsIds);
        await dbmsIds.mapEach((dbmsId) => this.environment.dbmss.uninstall(dbmsId)).unwindPromises();

        await fse.remove(this.environment.dataPath);
        await fse.remove(this.environment.configPath);
    }

    createName(): string {
        const shortUUID = uuid().slice(0, 8);
        return `[${shortUUID}] ${path.relative('..', this.filename)}`;
    }

    async createDbms(): Promise<IDbmsInfo> {
        const {id: dbmsId} = await this.environment.dbmss.install(
            this.createName(),
            TEST_NEO4J_VERSION,
            TEST_NEO4J_EDITION,
            TEST_NEO4J_CREDENTIALS,
        );

        const shortUUID = dbmsId.slice(0, 8);
        const numUUID = Array.from(shortUUID).reduce((sum, char, index) => {
            // Weight char codes before summing them, to avoid collisions when
            // strings contain the same characters.
            return sum + char.charCodeAt(0) * (index + 1);
        }, 0);

        // Increments of 10 to avoid collisions between the 3 different ports,
        // and max offset of 30k.
        const portOffset = (numUUID * 10) % 30000;

        const properties = await this.environment.dbmss.getDbmsConfig(dbmsId);
        properties.set('dbms.connector.bolt.listen_address', `:${7687 + portOffset}`);
        properties.set('dbms.connector.http.listen_address', `:${7474 + portOffset}`);
        properties.set('dbms.connector.https.listen_address', `:${7473 + portOffset}`);
        properties.set('dbms.backup.listen_address', `:${6362 + portOffset}`);
        await properties.flush();

        return this.environment.dbmss.get(dbmsId);
    }
}
