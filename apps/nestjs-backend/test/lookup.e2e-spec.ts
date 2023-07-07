/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { ILookupOptions, LinkFieldCore } from '@teable-group/core';
import { FieldKeyType, Colors, FieldType, Relationship, TimeFormatting } from '@teable-group/core';
import request from 'supertest';
import type { CreateFieldRo } from '../src/features/field/model/create-field.ro';
import type { FieldVo } from '../src/features/field/model/field.vo';
import type { RecordVo } from '../src/features/record/open-api/record.vo';
import type { UpdateRecordRo } from '../src/features/record/update-record.ro';
import type { TableVo } from '../src/features/table/table.vo';
import { initApp } from './utils/init-app';

// All kind of field type (except link)
const defaultFields: CreateFieldRo[] = [
  {
    name: FieldType.SingleLineText,
    type: FieldType.SingleLineText,
  },
  {
    name: FieldType.Number,
    type: FieldType.Number,
    options: {
      formatting: {
        precision: 2,
      },
    },
  },
  {
    name: FieldType.SingleSelect,
    type: FieldType.SingleSelect,
    options: {
      choices: [
        { name: 'todo', color: Colors.Yellow },
        { name: 'doing', color: Colors.Orange },
        { name: 'done', color: Colors.Green },
      ],
    },
  },
  {
    name: FieldType.MultipleSelect,
    type: FieldType.MultipleSelect,
    options: {
      choices: [
        { name: 'rap', color: Colors.Yellow },
        { name: 'rock', color: Colors.Orange },
        { name: 'hiphop', color: Colors.Green },
      ],
    },
  },
  {
    name: FieldType.Date,
    type: FieldType.Date,
    options: {
      formatting: {
        date: 'YYYY-MM-DD',
        time: TimeFormatting.Hour24,
        timeZone: 'America/New_York',
      },
      autoFill: false,
    },
  },
  {
    name: FieldType.Attachment,
    type: FieldType.Attachment,
  },
  {
    name: FieldType.Formula,
    type: FieldType.Formula,
    options: {
      expression: '1 + 1',
      formatting: {
        precision: 2,
      },
    },
  },
];

describe('OpenAPI Lookup field (e2e)', () => {
  let app: INestApplication;
  let table1: TableVo = {} as any;
  let table2: TableVo = {} as any;
  const tables: TableVo[] = [];

  async function updateTableFields(table: TableVo) {
    const tableFields = (
      await request(app.getHttpServer()).get(`/api/table/${table.id}/field`).expect(200)
    ).body.data;
    table.fields = tableFields;
    return tableFields;
  }

  beforeAll(async () => {
    app = await initApp();

    // create table1 with fundamental field
    const result1 = await request(app.getHttpServer())
      .post('/api/table')
      .send({
        name: 'table1',
        fields: defaultFields.map((f) => ({ ...f, name: f.name + '[table1]' })),
      })
      .expect(201);
    table1 = result1.body.data;

    // create table2 with fundamental field
    const result2 = await request(app.getHttpServer())
      .post('/api/table')
      .send({
        name: 'table2',
        fields: defaultFields.map((f) => ({ ...f, name: f.name + '[table2]' })),
      })
      .expect(201);
    table2 = result2.body.data;

    // create link field
    await request(app.getHttpServer())
      .post(`/api/table/${table1.id}/field`)
      .send({
        name: 'link[table1]',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      } as CreateFieldRo)
      .expect(201);
    // update fields in table after create link field
    await updateTableFields(table1);
    await updateTableFields(table2);
    // add a link record to first row
    await updateRecordByApi(
      table1.id,
      table1.data.records[0].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.data.records[0].id }]
    );
    tables.push(table1, table2);
  });

  afterAll(async () => {
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table1.id}`).expect(200);
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table2.id}`).expect(200);
    console.log('clear table: ', table1.name, table2.name);
  });

  function getFieldByType(fields: FieldVo[], type: FieldType) {
    const field = fields.find((field) => field.type === type);
    if (!field) {
      throw new Error('field not found');
    }
    return field;
  }
  function getFieldByName(fields: FieldVo[], name: string) {
    const field = fields.find((field) => field.name === name);
    if (!field) {
      throw new Error('field not found');
    }
    return field;
  }
  async function updateRecordByApi(
    tableId: string,
    recordId: string,
    fieldId: string,
    newValues: any
  ): Promise<RecordVo> {
    return (
      await request(app.getHttpServer())
        .put(`/api/table/${tableId}/record/${recordId}`)
        .send({
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [fieldId]: newValues,
            },
          },
        } as UpdateRecordRo)
        .expect(200)
    ).body.data;
  }

  async function getRecord(tableId: string, recordId: string): Promise<RecordVo['record']> {
    return (
      await request(app.getHttpServer())
        .get(`/api/table/${tableId}/record/${recordId}`)
        .query({
          fieldKeyType: FieldKeyType.Id,
        })
        .expect(200)
    ).body.data.record;
  }

  async function lookupTo(table: TableVo, lookupFieldId: string) {
    const linkField = getFieldByType(table.fields, FieldType.Link) as LinkFieldCore;
    const foreignTable = tables.find((t) => t.id === linkField.options.foreignTableId)!;
    const lookupField = foreignTable.fields.find((f) => f.id === lookupFieldId)!;
    const lookupFieldRo: CreateFieldRo = {
      name: `lookup ${lookupField.name} [${table.name}]`,
      type: lookupField.type,
      isLookup: true,
      options: lookupField.options?.formatting
        ? {
            formatting: lookupField.options.formatting,
          }
        : undefined,
      lookupOptions: {
        foreignTableId: foreignTable.id,
        linkFieldId: linkField.id,
        lookupFieldId, // getFieldByType(table2.fields, FieldType.SingleLineText).id,
      } as ILookupOptions,
    };

    // create lookup field
    await request(app.getHttpServer())
      .post(`/api/table/${table.id}/field`)
      .send(lookupFieldRo)
      .expect(201);

    await updateTableFields(table);
    return getFieldByName(table.fields, lookupFieldRo.name);
  }

  async function expectLookup(table: TableVo, fieldType: FieldType, updateValue: any) {
    const linkField = getFieldByType(table.fields, FieldType.Link) as LinkFieldCore;
    const foreignTable = tables.find((t) => t.id === linkField.options.foreignTableId)!;

    const lookedUpToField = getFieldByType(foreignTable.fields, fieldType);
    const lookupFieldVo = await lookupTo(table, lookedUpToField.id);

    // update a field that be lookup by previous field
    await updateRecordByApi(
      foreignTable.id,
      foreignTable.data.records[0].id,
      lookedUpToField.id,
      updateValue
    );

    const record = await getRecord(table.id, table.data.records[0].id);
    return expect(record.fields[lookupFieldVo.id]);
  }

  it('should update lookupField by edit the a be looked up field', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    console.log('lookedUpToField');
    const lookupFieldVo = await lookupTo(table1, lookedUpToField.id);
    console.log('lookedUpToField');

    // update a field that will be lookup by after field
    await updateRecordByApi(table2.id, table2.data.records[1].id, lookedUpToField.id, 123);

    // add a link record after
    await updateRecordByApi(
      table1.id,
      table1.data.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.data.records[1].id }]
    );

    const record = await getRecord(table1.id, table1.data.records[1].id);
    expect(record.fields[lookupFieldVo.id]).toEqual([123]);
  });

  it('should update lookupField by edit the a looked up text field', async () => {
    (await expectLookup(table1, FieldType.SingleLineText, 'lookup text')).toEqual(['lookup text']);
  });

  it('should update lookupField by edit the a looked up number field', async () => {
    (await expectLookup(table1, FieldType.Number, 123)).toEqual([123]);
  });

  it('should update lookupField by edit the a looked up singleSelect field', async () => {
    (await expectLookup(table1, FieldType.SingleSelect, 'todo')).toEqual(['todo']);
  });

  it('should update lookupField by edit the a looked up multipleSelect field', async () => {
    (await expectLookup(table1, FieldType.MultipleSelect, ['rap'])).toEqual(['rap']);
  });

  it('should update lookupField by edit the a looked up date field', async () => {
    const now = new Date().toISOString();
    (await expectLookup(table1, FieldType.Date, now)).toEqual([now]);
  });

  // it('should update lookupField by edit the a looked up attachment field', async () => {
  //   (await expectLookup(table1, FieldType.Attachment, 123)).toEqual([123]);
  // });

  // it('should update lookupField by edit the a looked up formula field', async () => {
  //   (await expectLookup(table1, FieldType.Number, 123)).toEqual([123]);
  // });

  it('should update link field lookup value', async () => {
    // add a link record after
    await updateRecordByApi(
      table1.id,
      table1.data.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.data.records[1].id }]
    );

    await updateRecordByApi(
      table2.id,
      table2.data.records[1].id,
      getFieldByType(table2.fields, FieldType.SingleLineText).id,
      'text'
    );

    const record = await getRecord(table1.id, table1.data.records[1].id);

    expect(record.fields[getFieldByType(table1.fields, FieldType.Link).id]).toEqual([
      { id: table2.data.records[1].id, title: 'text' },
    ]);
  });
});