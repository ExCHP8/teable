import { Injectable } from '@nestjs/common';
import type { FieldType, LinkFieldOptions } from '@teable-group/core';
import { Relationship, IdPrefix } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { difference } from 'lodash';
import type { ICellChange } from './reference.service';

export interface ITinyLinkField {
  id: string;
  tableId: string;
  type: FieldType;
  dbFieldName: string;
  options: LinkFieldOptions;
}

export interface ICellMutation {
  [tableId: string]: {
    [recordId: string]: {
      [fieldId: string]: {
        add: string[];
        del: string[];
      };
    };
  };
}

export interface IRecordMapByTableId {
  [tableId: string]: {
    [recordId: string]: {
      [fieldId: string]: { id: string }[] | { id: string } | undefined;
    };
  };
}

export interface ITinyFieldMapByTableId {
  [tableId: string]: {
    [fieldId: string]: ITinyLinkField;
  };
}

export interface ICellContext {
  id: string;
  fieldId: string;
  newValue?: { id: string }[] | { id: string };
  oldValue?: { id: string }[] | { id: string };
}

@Injectable()
export class LinkService {
  private readonly knex = knex({ client: 'sqlite3' });

  // for performance, we should detect if record contains link by cellValue
  private isLinkCell(value: unknown): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function isLinkCellItem(item: any): boolean {
      if (typeof item !== 'object' || item == null) {
        return false;
      }

      if ('id' in item && typeof item.id === 'string') {
        const recordId: string = item.id;
        return recordId.startsWith(IdPrefix.Record);
      }
      return false;
    }

    if (Array.isArray(value) && isLinkCellItem(value[0])) {
      return true;
    }
    return isLinkCellItem(value);
  }

  private filterLinkContext(contexts: ICellContext[]) {
    return contexts.filter((ctx) => {
      if (this.isLinkCell(ctx.newValue)) {
        return true;
      }

      return this.isLinkCell(ctx.oldValue);
    });
  }

  private async getTinyFieldsByIds(prisma: Prisma.TransactionClient, fieldIds: string[]) {
    const fieldRaws = await prisma.field.findMany({
      where: { id: { in: fieldIds } },
      select: { id: true, type: true, options: true, tableId: true, dbFieldName: true },
    });

    return fieldRaws.map<ITinyLinkField>((field) => ({
      ...field,
      type: field.type as FieldType,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      options: JSON.parse(field.options!),
    }));
  }

  private async getTinyFieldMapByTableId(
    prisma: Prisma.TransactionClient,
    fieldIds: string[]
  ): Promise<ITinyFieldMapByTableId> {
    const fields = await this.getTinyFieldsByIds(prisma, fieldIds);

    const symmetricFields = await this.getTinyFieldsByIds(
      prisma,
      fields.map((field) => field.options.symmetricFieldId)
    );

    return fields.concat(symmetricFields).reduce<ITinyFieldMapByTableId>((acc, field) => {
      const { tableId, id } = field;
      if (!acc[tableId]) {
        acc[tableId] = {};
      }
      acc[tableId][id] = field;
      return acc;
    }, {});
  }

  /**
   * test case
   *
   * case 1 Add Link Record From ManyOne link Field
   * TableA: ManyOne-LinkB A1.null -> A1.B1
   * { TableB: { B1: { 'OneMany-LinkA': add: [A1] }} }
   * TableB: OneMany-LinkA B1.null -> B1.push(A1)
   *
   * case 2 Change Link Record From ManyOne link Field
   * TableA: ManyOne-LinkB A1.B1 -> A1.B2
   * TableB: OneMany-LinkA B1.(Old) -> B1.pop(A1) | B2.(Old) -> B2.push(A1)
   *
   * case 3 Add Link Record From OneMany link Field
   * TableA: OneMany-linkB A1.(old) -> A1.push(B1)
   * TableB: ManyOne-LinkA B1.null -> B2.A1
   *
   * case 4 Change Link Record From OneMany link Field
   * TableA: OneMany-linkB A1.(old) -> A1.[B1]
   * TableB: ManyOne-LinkA B1.null -> B2.A1
   *
   */
  private getCellMutation(
    tableId: string,
    fieldMapByTableId: ITinyFieldMapByTableId,
    contexts: ICellContext[]
  ): ICellMutation {
    function polishValue(value?: { id: string }[] | { id: string }): string[] {
      if (Array.isArray(value)) {
        return value.map((item) => item.id);
      }
      if (value) {
        return [value.id];
      }
      return [];
    }
    return contexts.reduce<ICellMutation>((acc, ctx) => {
      const { id: recordId, fieldId, oldValue, newValue } = ctx;
      const oldIds = polishValue(oldValue);
      const newIds = polishValue(newValue);
      const toAdd = difference(newIds, oldIds);
      const toDel = difference(oldIds, newIds);
      const { foreignTableId, symmetricFieldId } = fieldMapByTableId[tableId][fieldId].options;

      if (!acc[foreignTableId]) {
        acc[foreignTableId] = {};
      }

      const prepare = (targetRecordId: string) => {
        if (!acc[foreignTableId][targetRecordId]) {
          acc[foreignTableId][targetRecordId] = {};
        }
        if (!acc[foreignTableId][targetRecordId][symmetricFieldId]) {
          acc[foreignTableId][targetRecordId][symmetricFieldId] = {
            add: [],
            del: [],
          };
        }
        return acc[foreignTableId][targetRecordId][symmetricFieldId];
      };

      for (const addRecordId of toAdd) {
        prepare(addRecordId).add.push(recordId);
      }
      for (const deleteRecordId of toDel) {
        prepare(deleteRecordId).del.push(recordId);
      }

      return acc;
    }, {});
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private getCellChangeByMutation(
    cellMutation: ICellMutation,
    recordMapByTableId: IRecordMapByTableId,
    fieldMapByTableId: ITinyFieldMapByTableId
  ): ICellChange[] {
    const changes: ICellChange[] = [];
    for (const tableId in cellMutation) {
      for (const recordId in cellMutation[tableId]) {
        for (const fieldId in cellMutation[tableId][recordId]) {
          const { add, del } = cellMutation[tableId][recordId][fieldId];
          const oldValue = recordMapByTableId[tableId][recordId][fieldId];
          const field = fieldMapByTableId[tableId][fieldId];
          if (field.options.relationship === Relationship.ManyOne) {
            if (oldValue && !('id' in oldValue)) {
              throw new Error("ManyOne relationship's old value should be a single record");
            }

            if (add.length > 1 || del.length > 1) {
              throw new Error('ManyOne relationship should not have multiple records');
            }

            if (del.length && del[0] !== oldValue?.id) {
              throw new Error("ManyOne relationship's old value should be equal to delete value");
            }

            changes.push({
              tableId,
              recordId,
              fieldId,
              oldValue,
              newValue: add[0] ? { id: add[0] } : undefined,
            });
            continue;
          }

          let newValue: { id: string }[] = [];
          if (oldValue) {
            newValue = (oldValue as { id: string }[]).filter((item) => !del.includes(item.id));
          }
          newValue.push(...add.map((id) => ({ id })));

          changes.push({
            tableId,
            recordId,
            fieldId,
            oldValue,
            newValue: newValue.length ? newValue : undefined,
          });
        }
      }
    }
    return changes;
  }

  private async getRecordMapByMutation(
    prisma: Prisma.TransactionClient,
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: ITinyFieldMapByTableId,
    cellMutation: ICellMutation
  ): Promise<IRecordMapByTableId> {
    const recordMapByTableId: IRecordMapByTableId = {};
    for (const tableId in cellMutation) {
      const recordIds = Object.keys(cellMutation[tableId]);
      const fieldIds = Array.from(
        Object.values(cellMutation[tableId]).reduce<Set<string>>((pre, cur) => {
          for (const fieldId in cur) {
            pre.add(fieldId);
          }
          return pre;
        }, new Set())
      );

      const dbFieldName2FieldId: { [dbFieldName: string]: string } = {};
      const dbFieldNames = fieldIds.map((fieldId) => {
        const field = fieldMapByTableId[tableId][fieldId];
        dbFieldName2FieldId[field.dbFieldName] = fieldId;
        return field.dbFieldName;
      });

      const nativeSql = this.knex(tableId2DbTableName[tableId])
        .select(dbFieldNames, '__id')
        .whereIn('__id', recordIds)
        .toSQL()
        .toNative();

      const recordRaw = await prisma.$queryRawUnsafe<{ [dbTableName: string]: unknown }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );

      recordMapByTableId[tableId] = recordRaw.reduce<{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [recordId: string]: { [fieldId: string]: any };
      }>((acc, cur) => {
        const recordId = cur.__id as string;
        delete cur.__id;
        acc[recordId] = {};
        for (const dbFieldName in cur) {
          const fieldId = dbFieldName2FieldId[dbFieldName];

          acc[recordId][fieldId] = cur[dbFieldName];
        }
        return acc;
      }, {});
    }

    return recordMapByTableId;
  }

  // update foreignKey by ManyOne relationship field value changes
  private async updateForeignKey(
    prisma: Prisma.TransactionClient,
    tableId2DbTableName: { [tableId: string]: string },
    fieldMapByTableId: ITinyFieldMapByTableId,
    changes: ICellChange[]
  ) {
    for (const change of changes) {
      const { tableId, recordId, fieldId, newValue } = change;
      const dbTableName = tableId2DbTableName[tableId];
      const field = fieldMapByTableId[tableId][fieldId];
      const dbForeignKeyName = field.options.dbForeignKeyName;
      if (field.options.relationship !== Relationship.ManyOne) {
        continue;
      }

      const nativeSql = this.knex(dbTableName)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ [dbForeignKeyName]: newValue ? (newValue as any).id : null })
        .where('__id', recordId)
        .toSQL()
        .toNative();

      await prisma.$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
    }
  }

  private async getTableId2DbTableName(prisma: Prisma.TransactionClient, tableIds: string[]) {
    const tableRaws = await prisma.tableMeta.findMany({
      where: {
        id: {
          in: tableIds,
        },
      },
      select: {
        id: true,
        dbTableName: true,
      },
    });
    return tableRaws.reduce<{ [tableId: string]: string }>((acc, cur) => {
      acc[cur.id] = cur.dbTableName;
      return acc;
    }, {});
  }

  /**
   * 1. diff changes from context, merge all off changes by recordId
   * 2. generate new changes from merged changes
   * 3. update foreign key by changes
   */
  async getDerivateChangesByLink(
    prisma: Prisma.TransactionClient,
    tableId: string,
    contexts: ICellContext[]
  ): Promise<ICellChange[]> {
    const linkContext = this.filterLinkContext(contexts);
    if (!linkContext.length) {
      return [];
    }

    const fieldIds = linkContext.map((ctx) => ctx.fieldId);
    const fieldMapByTableId = await this.getTinyFieldMapByTableId(prisma, fieldIds);
    const cellMutation = this.getCellMutation(tableId, fieldMapByTableId, linkContext);
    const tableId2DbTableName = await this.getTableId2DbTableName(
      prisma,
      Object.keys(fieldMapByTableId)
    );

    const recordMapByTableId = await this.getRecordMapByMutation(
      prisma,
      tableId2DbTableName,
      fieldMapByTableId,
      cellMutation
    );

    const cellChange = this.getCellChangeByMutation(
      cellMutation,
      recordMapByTableId,
      fieldMapByTableId
    );

    if (cellChange.length) {
      await this.updateForeignKey(prisma, tableId2DbTableName, fieldMapByTableId, cellChange);
    }

    return cellChange;
  }
}