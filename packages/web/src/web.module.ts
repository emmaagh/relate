import {DynamicModule, Inject, Module, OnModuleInit} from '@nestjs/common';
import {GraphQLModule, GraphQLSchemaHost} from '@nestjs/graphql';
import {HttpAdapterHost} from '@nestjs/core';
import {ConfigService} from '@nestjs/config';
import {envPaths, SystemModule, EXTENSION_TYPES, loadExtensionsFor, ISystemModuleConfig} from '@relate/common';
import {Application} from 'express';
import {OpenAPI, useSofa} from 'sofa-api';
import swaggerUi from 'swagger-ui-express';
import multer from 'multer';

import {ExtensionModule} from './entities/extension';
import {DBModule} from './entities/db';
import {DBMSModule} from './entities/dbms';
import {ProjectModule} from './entities/project';
import {AuthModule} from './auth';
import {FilesModule} from './files';
import {HealthModule} from './health';
import {fixAddProjectFilesOpenAPIDef} from './utils/open-api.utils';
import {DBMSPluginsModule} from './entities/dbms-plugins';

export interface IWebModuleConfig extends ISystemModuleConfig {
    protocol?: string;
    host?: string;
    port?: number;
    autoSchemaFile?: string | boolean;
}

@Module({
    imports: [
        SystemModule,
        DBMSModule,
        DBMSPluginsModule,
        DBModule,
        ExtensionModule,
        ProjectModule,
        FilesModule,
        GraphQLModule.forRootAsync({
            // @todo: recommended to use graphql-ws
            // https://docs.nestjs.com/graphql/subscriptions#enable-subscriptions
            useFactory: (configService: ConfigService<IWebModuleConfig>) => ({
                installSubscriptionHandlers: true,
                playground: {
                    settings: {
                        'request.credentials': 'same-origin',
                    },
                },
                autoSchemaFile: configService.get('autoSchemaFile'),
            }),
            inject: [ConfigService],
        }),
        HealthModule,
        AuthModule,
    ],
})
export class WebModule implements OnModuleInit {
    static register(config: IWebModuleConfig): DynamicModule {
        const {defaultEnvironmentNameOrId} = config;
        const webExtensions = loadExtensionsFor(EXTENSION_TYPES.WEB, defaultEnvironmentNameOrId);

        return {
            imports: [SystemModule.register(config), ...webExtensions],
            module: WebModule,
            exports: [SystemModule, ...webExtensions],
        };
    }

    constructor(
        @Inject(GraphQLSchemaHost) private readonly schemaHost: GraphQLSchemaHost,
        @Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost,
    ) {}

    onModuleInit(): void {
        if (!this.httpAdapterHost) {
            return;
        }

        const {httpAdapter} = this.httpAdapterHost;
        const app: Application = httpAdapter.getInstance();
        const {schema} = this.schemaHost;
        const openApi = OpenAPI({
            schema,
            info: {
                title: 'Relate REST API',
                version: '1.0.0',
            },
        });

        // add multer to file upload endpoints
        const uploads = multer({dest: envPaths().tmp});

        app.use('/api/add-project-file', uploads.single('fileUpload'), (req, _, next) => {
            req.body = {
                ...req.body,
                fileUpload: {
                    // convert multer file object to the same shape as graphql-upload
                    ...req.file,
                    filename: req.file.originalname,
                },
            };
            next();
        });

        // convert GraphQL API to REST using SOFA
        app.use(
            '/api',
            useSofa({
                basePath: '/api',
                schema,
                onRoute(info) {
                    openApi.addRoute(info, {
                        basePath: '/api',
                    });
                },
            }),
        );

        // add Swagger page for REST API
        const openApiDefinitions = openApi.get();
        openApiDefinitions.paths['/api/add-project-file'] = fixAddProjectFilesOpenAPIDef(
            openApiDefinitions.paths['/api/add-project-file'],
        );

        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDefinitions));
    }
}
