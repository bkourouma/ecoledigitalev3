import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/utils";

export async function issueVerificationToken({
  email,
  firstName,
}: {
  email: string;
  firstName?: string | null;
}) {
  await prisma.verificationToken.deleteMany({
    where: { identifier: email },
  });

  const token = randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);

  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token,
      expires,
    },
  });

  await sendVerificationEmail({
    to: email,
    firstName,
    verificationUrl: absoluteUrl(`/verify?token=${token}`),
  });

  return { token, expires };
}

export async function consumeVerificationToken(token: string) {
  const verificationToken = await prisma.verificationToken.findUnique({
    where: { token },
  });

  if (!verificationToken) {
    return {
      state: "invalid" as const,
      email: null,
    };
  }

  const email = verificationToken.identifier;
  const user = await prisma.publicUser.findUnique({
    where: { email },
    select: {
      email: true,
      emailVerified: true,
    },
  });

  if (!user) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => undefined);
    return {
      state: "invalid" as const,
      email,
    };
  }

  if (user.emailVerified) {
    await prisma.verificationToken.deleteMany({
      where: { identifier: email },
    });

    return {
      state: "already-verified" as const,
      email,
    };
  }

  if (verificationToken.expires <= new Date()) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => undefined);
    return {
      state: "expired" as const,
      email,
    };
  }

  await prisma.publicUser.update({
    where: { email },
    data: { emailVerified: new Date() },
  });

  await prisma.verificationToken.deleteMany({
    where: { identifier: email },
  });

  return {
    state: "success" as const,
    email,
  };
}
