import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getLearningSupport } from "@/lib/learning";

export const runtime = "nodejs";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const STORAGE_BASE_PATH = path.resolve(
  process.env.FILE_STORAGE_PATH || path.join(process.cwd(), "../api/uploads")
);

function resolveBackendUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  return new URL(pathOrUrl, API_BASE_URL).toString();
}

function guessMimeTypeFromFilename(filename: string) {
  const extension = path.extname(filename).toLowerCase().replace(".", "");
  const mimeTypes: Record<string, string> = {
    webm: "video/webm",
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    ogv: "video/ogg",
    ogg: "application/ogg",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
  };

  return mimeTypes[extension] || "application/octet-stream";
}

function extractFileKey(filePath: string) {
  const match = filePath.match(/^\/api\/v1\/files\/(.+)$/);
  return match?.[1] || null;
}

function resolveStorageFilePath(fileKey: string) {
  const absolutePath = path.resolve(STORAGE_BASE_PATH, ...fileKey.split("/"));
  const relativePath = path.relative(STORAGE_BASE_PATH, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Chemin de fichier invalide");
  }

  return absolutePath;
}

async function getContentTypeFromMetadata(filePath: string) {
  try {
    const metadata = JSON.parse(await readFile(`${filePath}.meta.json`, "utf8")) as {
      contentType?: string;
    };

    if (metadata.contentType?.trim()) {
      return metadata.contentType;
    }
  } catch {
    // Metadata is optional.
  }

  return guessMimeTypeFromFilename(path.basename(filePath));
}

function buildInlineDisposition(filename: string, contentType: string) {
  const inlinePreview =
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/") ||
    contentType.startsWith("image/") ||
    contentType === "application/pdf";

  return `${inlinePreview ? "inline" : "attachment"}; filename="${filename.replace(/"/g, "_")}"`;
}

async function serveLocalFile(request: NextRequest, filePath: string) {
  const fileKey = extractFileKey(filePath);

  if (!fileKey) {
    return NextResponse.json({ error: "URL de fichier invalide" }, { status: 400 });
  }

  const absoluteFilePath = resolveStorageFilePath(fileKey);
  const fileStats = await stat(absoluteFilePath);
  const fileName = path.basename(absoluteFilePath);
  const contentType = await getContentTypeFromMetadata(absoluteFilePath);
  const baseHeaders = new Headers({
    "content-type": contentType,
    "content-disposition": buildInlineDisposition(fileName, contentType),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=0, must-revalidate",
  });

  const range = request.headers.get("range");
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);

    if (!match) {
      return new NextResponse("Invalid Range header", { status: 416 });
    }

    const [, startPart, endPart] = match;
    let start = startPart ? Number.parseInt(startPart, 10) : 0;
    let end = endPart ? Number.parseInt(endPart, 10) : fileStats.size - 1;

    if (!startPart && endPart) {
      const suffixLength = Number.parseInt(endPart, 10);
      start = Math.max(fileStats.size - suffixLength, 0);
      end = fileStats.size - 1;
    }

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      end < start ||
      start >= fileStats.size
    ) {
      return new NextResponse("Requested range not satisfiable", {
        status: 416,
        headers: {
          "content-range": `bytes */${fileStats.size}`,
        },
      });
    }

    end = Math.min(end, fileStats.size - 1);
    const chunkSize = end - start + 1;
    const stream = createReadStream(absoluteFilePath, { start, end });

    baseHeaders.set("content-length", String(chunkSize));
    baseHeaders.set("content-range", `bytes ${start}-${end}/${fileStats.size}`);

    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: baseHeaders,
    });
  }

  const stream = createReadStream(absoluteFilePath);
  baseHeaders.set("content-length", String(fileStats.size));

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: baseHeaders,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ supportId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { supportId } = await params;
  const slug = request.nextUrl.searchParams.get("slug");

  if (!slug) {
    return NextResponse.json({ error: "slug requis" }, { status: 400 });
  }

  const payload = await getLearningSupport(session.user.id, slug, supportId);
  if (!payload) {
    return NextResponse.json({ error: "Support introuvable" }, { status: 404 });
  }

  if (payload.support.fichierUrl.startsWith("/api/v1/files/")) {
    try {
      return await serveLocalFile(request, payload.support.fichierUrl);
    } catch {
      return NextResponse.json(
        { error: "Impossible de lire le fichier local." },
        { status: 500 }
      );
    }
  }

  return NextResponse.redirect(resolveBackendUrl(payload.support.fichierUrl));
}
