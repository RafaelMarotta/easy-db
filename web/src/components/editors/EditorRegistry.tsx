import React from "react";
import { CellEditorProps } from "./types";
import { TextEditor } from "./TextEditor";
import { NumberEditor } from "./NumberEditor";
import { DateTimeEditor } from "./DateTimeEditor";
import { DateEditor } from "./DateEditor";
import { BooleanEditor } from "./BooleanEditor";

type Editor = (p: CellEditorProps) => JSX.Element;

const registry: Record<string, Editor> = {
  text: (p) => <TextEditor {...p} />,
  number: (p) => <NumberEditor {...p} />,
  datetime: (p) => <DateTimeEditor {...p} />,
  date: (p) => <DateEditor {...p} />,
  time: (p) => <TextEditor {...p} />,
  boolean: (p) => <BooleanEditor {...p} />,
};

export function renderEditor(p: CellEditorProps) {
  const key = (p.inputType || 'text').toLowerCase();
  const Editor = registry[key] || registry.text;
  return <Editor {...p} />;
}


