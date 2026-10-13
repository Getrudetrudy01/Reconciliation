import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { EXCEPTION_STATUSES, type ExceptionStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PatchPayload {
  status?: ExceptionStatus;
  resolutionNote?: string | null;
  resolvedBy?: string | null;
}

/** Update the exception workflow fields on one saved row (status / note / owner). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: PatchPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.status !== undefined && !EXCEPTION_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of ${EXCEPTION_STATUSES.join(", ")}.` },
      { status: 400 },
    );
  }

  const existing = await prisma.reconciliationRow.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json({ error: "Row not found." }, { status: 404 });
  }

  const nextStatus = body.status ?? (existing.status as ExceptionStatus);

  const row = await prisma.reconciliationRow.update({
    where: { id: params.id },
    data: {
      status: nextStatus,
      resolutionNote: body.resolutionNote !== undefined ? body.resolutionNote?.trim() || null : undefined,
      resolvedBy: body.resolvedBy !== undefined ? body.resolvedBy?.trim() || null : undefined,
      resolvedAt: nextStatus === "Resolved" ? (existing.resolvedAt ?? new Date()) : null,
    },
  });

  return NextResponse.json(row);
}
