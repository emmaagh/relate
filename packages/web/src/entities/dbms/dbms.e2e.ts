import {INestApplication} from '@nestjs/common';
import {Test} from '@nestjs/testing';
import {ConfigModule} from '@nestjs/config';
import request from 'supertest';
import {
    TestDbmss,
    IDbms,
    DBMS_STATUS,
    NEO4J_DIST_VERSIONS_URL,
    NEO4J_EDITION,
    NEO4J_ORIGIN,
    IDbmsVersion,
} from '@relate/common';
import nock from 'nock';

import configuration from '../../configs/dev.config';
import {WebModule} from '../../web.module';

let TEST_DBMS_NAME: string;
let TEST_DBMS_ID: string;
const TEST_APP_ID = 'foo';

const JWT_REGEX = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/m;
const HTTP_OK = 200;

const queryBody = (query: string, variables?: {[key: string]: any}): {[key: string]: any} => ({
    query,
    variables: {
        dbmsName: TEST_DBMS_NAME,
        dbmsId: TEST_DBMS_ID,
        dbmsNames: [TEST_DBMS_NAME],
        environmentNameOrId: 'test',
        ...variables,
    },
});
const neo4jVersionsUrl = new URL(NEO4J_DIST_VERSIONS_URL);

jest.setTimeout(240000);

describe('DBMSModule', () => {
    let app: INestApplication;
    let dbmss: TestDbmss;

    beforeAll(async () => {
        dbmss = await TestDbmss.init(__filename);
        const {name, id} = await dbmss.environment.dbmss.install(
            dbmss.createName(),
            TestDbmss.NEO4J_VERSION,
            TestDbmss.NEO4J_EDITION,
            TestDbmss.DBMS_CREDENTIALS,
        );

        TEST_DBMS_NAME = name;
        TEST_DBMS_ID = id;

        const module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({
                    isGlobal: true,
                    load: [configuration],
                }),
                WebModule.register({
                    defaultEnvironmentNameOrId: dbmss.environment.id,
                    ...configuration(),
                }),
            ],
        }).compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterAll(() => dbmss.teardown());

    describe('dbms stopped', () => {
        test('/graphql listDbmss', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `query ListDBMSSs($environmentNameOrId: String) {
                            listDbmss(environmentNameOrId: $environmentNameOrId) {
                                id,
                                name,
                                description
                            }
                        }`,
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {listDbmss} = res.body.data;
                    expect(listDbmss.map(({name}: IDbms) => name)).toContain(TEST_DBMS_NAME);
                });
        });

        test('/graphql infoDbmss (stopped DBMS)', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `query InfoDBMSSs($environmentNameOrId: String, $dbmsNames: [String!]!) {
                            infoDbmss(environmentNameOrId: $environmentNameOrId, dbmsIds: $dbmsNames) {
                                name
                                status
                            }
                        }`,
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {infoDbmss} = res.body.data;
                    expect(infoDbmss[0].name).toEqual(TEST_DBMS_NAME);
                    expect(infoDbmss[0].status).toEqual(DBMS_STATUS.STOPPED);
                });
        });

        test('/graphql infoDbmss (non existent environment)', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `query InfoDBMSs {
                            infoDbmss(environmentNameOrId: "non-existent", dbmsIds: ["test"]) {
                                name
                                status
                            }
                        }`,
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {errors} = res.body;
                    expect(errors).toHaveLength(1);
                    expect(errors[0].message).toBe('Environment "non-existent" not found');
                });
        });

        test('/graphql infoDbmss (non existent DBMS)', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `query InfoDBMSs($environmentNameOrId: String) {
                            infoDbmss(environmentNameOrId: $environmentNameOrId, dbmsIds: ["non-existent"]) {
                                name
                                status
                            }
                        }`,
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {errors} = res.body;
                    expect(errors).toHaveLength(1);
                    expect(errors[0].message).toBe('DBMS "non-existent" not found');
                });
        });

        test('/graphql listDbmsVersions', () => {
            nock(neo4jVersionsUrl.origin)
                .get(neo4jVersionsUrl.pathname)
                .reply(200, {
                    tags: {latest: '4.0.1'},
                    versions: {
                        '3.3.17': {
                            dist: {
                                linux: 'https://dist.neo4j.org/neo4j-enterprise-3.5.17-unix.tar.gz',
                                mac: 'https://dist.neo4j.org/neo4j-enterprise-3.5.17-unix.tar.gz',
                                win: 'https://dist.neo4j.org/neo4j-enterprise-3.5.17-windows.zip',
                            },
                        },
                        '4.0.0': {
                            dist: {
                                linux: 'https://dist.neo4j.org/neo4j-enterprise-4.0.0-unix.tar.gz',
                                mac: 'https://dist.neo4j.org/neo4j-enterprise-4.0.0-unix.tar.gz',
                                win: 'https://dist.neo4j.org/neo4j-enterprise-4.0.0-windows.zip',
                            },
                        },
                        '4.0.1': {
                            dist: {
                                linux: 'https://dist.neo4j.org/neo4j-enterprise-4.0.1-unix.tar.gz',
                                mac: 'https://dist.neo4j.org/neo4j-enterprise-4.0.1-unix.tar.gz',
                                win: 'https://dist.neo4j.org/neo4j-enterprise-4.0.1-windows.zip',
                            },
                        },
                    },
                });
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `query ListDbmsVersions {
                            listDbmsVersions {
                                edition
                                version
                                origin
                                dist
                            }
                        }`,
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {listDbmsVersions} = res.body.data;

                    expect(listDbmsVersions.length).not.toEqual(0);
                    listDbmsVersions.forEach((v: IDbmsVersion) => {
                        if (v.origin === NEO4J_ORIGIN.ONLINE) {
                            expect(v.origin).toEqual(NEO4J_ORIGIN.ONLINE);
                            expect(v.dist).toContain('https://dist.neo4j.org/');
                        }
                        expect(v.edition).toBe(NEO4J_EDITION.ENTERPRISE);
                        expect(v.version).not.toEqual('3.3.17');
                    });
                });
        });

        test('/graphql addDbmsTags', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `
                mutation dbmsTags($environmentNameOrId: String, $dbmsName: String!, $tags: [String!]!) {
                    addDbmsTags(environmentNameOrId: $environmentNameOrId, dbmsId: $dbmsName, tags: $tags) {
                        name
                        tags
                    }
                }
            `,
                        {tags: ['tag1', 'tag2']},
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {addDbmsTags} = res.body.data;
                    const expected = {
                        name: TEST_DBMS_NAME,
                        tags: ['tag1', 'tag2'],
                    };

                    expect(addDbmsTags).toEqual(expected);
                });
        });

        test('/graphql removeDbmsTags', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `
                    mutation dbmsTags($environmentNameOrId: String, $dbmsName: String!, $tags: [String!]!) {
                        removeDbmsTags(environmentNameOrId: $environmentNameOrId, dbmsId: $dbmsName, tags: $tags) {
                            name
                            tags
                        }
                    }
                `,
                        {tags: ['tag1', 'tag2']},
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {removeDbmsTags} = res.body.data;
                    const expected = {
                        name: TEST_DBMS_NAME,
                        tags: [],
                    };

                    expect(removeDbmsTags).toEqual(expected);
                });
        });

        test('/graphql setDbmsMetadata', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `
                        mutation dbmsMetadata(
                            $environmentNameOrId: String,
                            $dbmsName: String!,
                            $key: String!,
                            $value: JSON!
                        ) {
                            setDbmsMetadata(
                                environmentNameOrId: $environmentNameOrId,
                                dbmsId: $dbmsName,
                                key: $key,
                                value: $value,
                            ) {
                                name
                                metadata
                            }
                        }
                    `,
                        {
                            key: 'someKey',
                            value: {
                                value1: 'someValue',
                                value2: {
                                    foo: 10,
                                },
                            },
                        },
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {setDbmsMetadata} = res.body.data;
                    const expected = {
                        name: TEST_DBMS_NAME,
                        metadata: {
                            someKey: {
                                value1: 'someValue',
                                value2: {
                                    foo: 10,
                                },
                            },
                        },
                    };

                    expect(setDbmsMetadata).toEqual(expected);
                });
        });

        test('/graphql removeDbmsMetadata', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `
                    mutation dbmsMetadata($environmentNameOrId: String, $dbmsName: String!, $keys: [String!]!) {
                        removeDbmsMetadata(environmentNameOrId: $environmentNameOrId, dbmsId: $dbmsName, keys: $keys) {
                            name
                            metadata
                        }
                    }
                `,
                        {keys: ['someKey']},
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {removeDbmsMetadata} = res.body.data;
                    const expected = {
                        name: TEST_DBMS_NAME,
                        metadata: {},
                    };

                    expect(removeDbmsMetadata).toEqual(expected);
                });
        });

        test('/graphql upgradeDbms (upgrade version <= current version)', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `
                    mutation UpgradeDbms($environmentNameOrId: String, $dbmsId: String!, $version: String!) {
                        upgradeDbms(environmentNameOrId: $environmentNameOrId, dbmsId: $dbmsId, version: $version) {
                            id
                            name
                            version
                        }
                    }
                `,
                        {version: '4.0.1'},
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {errors} = res.body;
                    expect(errors).toHaveLength(1);
                    expect(errors[0].message).toContain('Target version must be greater than 4.0.12');
                });
        });

        test('/graphql upgradeDbms (upgrade version >= current version)', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `
                    mutation UpgradeDbms($environmentNameOrId: String, $dbmsId: String!, $version: String!) {
                        upgradeDbms(environmentNameOrId: $environmentNameOrId, dbmsId: $dbmsId, version: $version) {
                            id
                            name
                            version
                        }
                    }
                `,
                        {version: '4.1.0'},
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {upgradeDbms} = res.body.data;
                    expect(upgradeDbms.id).toBe(TEST_DBMS_ID);
                });
        });
    });

    describe('dbms started', () => {
        test('/graphql startDbmss', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `mutation StartDBMSSs($environmentNameOrId: String, $dbmsNames: [String!]!) {
                            startDbmss(environmentNameOrId: $environmentNameOrId, dbmsIds: $dbmsNames)
                        }`,
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {startDbmss} = res.body.data;

                    if (process.platform === 'win32') {
                        expect(startDbmss[0]).toContain('neo4j started');
                    } else {
                        expect(startDbmss[0]).toContain('Directories in use');
                        expect(startDbmss[0]).toContain('Starting Neo4j');
                        expect(startDbmss[0]).toContain('Started neo4j (pid');
                    }
                });
        });

        test('/graphql infoDbmss (started DBMS)', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `query InfoDBMSs($environmentNameOrId: String, $dbmsNames: [String!]!) {
                            infoDbmss(environmentNameOrId: $environmentNameOrId, dbmsIds: $dbmsNames) {
                                name
                                status
                            }
                        }`,
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {infoDbmss} = res.body.data;
                    expect(infoDbmss[0].name).toEqual(TEST_DBMS_NAME);
                    expect(infoDbmss[0].status).toEqual(DBMS_STATUS.STARTED);
                });
        });

        test('/graphql accessDbms (started DBMS)', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `mutation AccessDBMS(
                            $environmentNameOrId: String,
                            $dbmsName: String!,
                            $authToken: AuthTokenInput!,
                            $appName: String!
                        ) {
                            createAccessToken(
                                environmentNameOrId: $environmentNameOrId,
                                dbmsId: $dbmsName,
                                appName: $appName,
                                authToken: $authToken
                            )
                        }`,
                        {
                            appName: TEST_APP_ID,
                            authToken: {
                                credentials: TestDbmss.DBMS_CREDENTIALS,
                                principal: 'neo4j',
                                scheme: 'basic',
                            },
                        },
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {createAccessToken} = res.body.data;
                    expect(createAccessToken).toEqual(expect.stringMatching(JWT_REGEX));
                });
        });

        test('/graphql upgradeDbms (upgrade version > current version)', () => {
            return request(app.getHttpServer())
                .post('/graphql')
                .send(
                    queryBody(
                        `
                    mutation UpgradeDbms($environmentNameOrId: String, $dbmsId: String!, $version: String!) {
                        upgradeDbms(environmentNameOrId: $environmentNameOrId, dbmsId: $dbmsId, version: $version) {
                            id
                            name
                            version
                        }
                    }
                `,
                        {version: '4.1.1'},
                    ),
                )
                .expect(HTTP_OK)
                .expect((res: request.Response) => {
                    const {errors} = res.body;
                    expect(errors).toHaveLength(1);
                    expect(errors[0].message).toContain('Can only upgrade stopped dbms');
                });
        });
    });
});
