import cli from 'cli-ux';

import {ListModule} from '../../modules/dbms/list.module';
import BaseCommand from '../../base.command';
import {DBMS_FLAGS} from '../../constants';

export default class ListCommand extends BaseCommand {
    commandClass = ListCommand;

    commandModule = ListModule;

    static flags = {
        ...cli.table.flags({except: ['extended', 'csv']}),
        ...DBMS_FLAGS,
    };
}