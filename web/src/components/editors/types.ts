export interface CellEditorProps {
  value: any;
  rowIndex: number;
  columnId: string;
  readOnly: boolean;
  inputType?: string;
  onEdit: (rowIndex: number, columnId: string, value: string) => void;
}


