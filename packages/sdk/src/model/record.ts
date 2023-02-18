import {
  FieldCore,
  IRecordFields,
  IRecordSnapshot,
  OpBuilder,
  RecordCore,
} from '@teable-group/core';
import { Doc } from 'sharedb/lib/client';

export class Record extends RecordCore {
  constructor(
    protected doc: Doc<IRecordSnapshot>,
    protected fields: { [fieldId: string]: FieldCore },
    protected data: IRecordFields
  ) {
    super(fields, data);
  }

  async updateCell(fieldId: string, cellValue: unknown) {
    const operation = OpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: cellValue,
      oldCellValue: this.data[fieldId],
    });

    return new Promise((resolve, reject) => {
      this.doc.submitOp([operation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}