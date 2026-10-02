import { VerifyScreen } from "./_components/VerifyScreen";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <VerifyScreen initialCode={code ?? ""} />;
}
