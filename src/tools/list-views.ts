import { sql } from '../connection.js';
import { BaseTool, QueryParam } from './base.js';
import { ViewInfo } from '../types.js';
import { ParameterValidator } from '../validation.js';

export class ListViewsTool extends BaseTool {
  getName(): string {
    return 'list_views';
  }

  getDescription(): string {
    return 'List all views in the current database or specified schema';
  }

  getInputSchema(): any {
    return {
      type: 'object',
      properties: {
        schema: {
          type: 'string',
          description: 'Schema name to filter views (optional)',
        },
      },
      required: [],
    };
  }

  async execute(params: { schema?: string }): Promise<ViewInfo[]> {
    const validatedParams = ParameterValidator.validateListTablesParameters(params);
    const { schema } = validatedParams;

    const inputs: QueryParam[] = [];

    let query = `
      SELECT
        TABLE_CATALOG as table_catalog,
        TABLE_SCHEMA as table_schema,
        TABLE_NAME as table_name,
        VIEW_DEFINITION as view_definition,
        CHECK_OPTION as check_option,
        IS_UPDATABLE as is_updatable
      FROM INFORMATION_SCHEMA.VIEWS
    `;

    if (schema) {
      query += ` WHERE TABLE_SCHEMA = @schema`;
      inputs.push({ name: 'schema', type: sql.NVarChar(128), value: schema });
    }

    query += ' ORDER BY TABLE_SCHEMA, TABLE_NAME';

    return await this.executeSafeQueryWithParams<ViewInfo>(query, inputs);
  }
}