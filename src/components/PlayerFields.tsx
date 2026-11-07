import { Field } from "./ActionForm";

export function PlayerFields({ p }: { p?: any }) {
  return (
    <div className="form-row">
      <Field label="Name *"><input name="name" required maxLength={100} defaultValue={p?.name} /></Field>
      <Field label="Title"><input name="title" maxLength={10} placeholder="GM, IM, FM…" defaultValue={p?.title ?? ""} /></Field>
      <Field label="Federation" hint="3 letters"><input name="federation" pattern="[A-Za-z]{3}" maxLength={3} placeholder="IND" defaultValue={p?.federation ?? ""} /></Field>
      <Field label="Rating"><input name="rating" type="number" min={0} max={3500} defaultValue={p?.rating ?? ""} /></Field>
      <Field label="Birth year"><input name="birth_year" type="number" min={1850} max={2100} defaultValue={p?.birth_year ?? ""} /></Field>
    </div>
  );
}
