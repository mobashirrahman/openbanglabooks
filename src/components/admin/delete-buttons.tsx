"use client";

import { deleteAuthor, deleteEdition, deleteWork } from "@/lib/admin/actions";
import type { Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import { DeleteForm, type AdminLabels } from "./form-kit";

type Props = { id: string; name: string; locale: Locale; labels: AdminLabels };

export function DeleteWork({ id, name, locale, labels }: Props) {
  return <DeleteForm action={deleteWork} fields={{ id, locale }} label={labels.delete} confirm={t(labels.deleteConfirm, { name })} labels={labels} />;
}

export function DeleteAuthor({ id, name, locale, labels }: Props) {
  return <DeleteForm action={deleteAuthor} fields={{ id, locale }} label={labels.delete} confirm={t(labels.deleteConfirm, { name })} labels={labels} />;
}

export function DeleteEdition({ id, workId, name, locale, labels }: Props & { workId: string }) {
  return <DeleteForm action={deleteEdition} fields={{ id, work_id: workId, locale }} label={labels.delete} confirm={t(labels.deleteConfirm, { name })} labels={labels} />;
}
