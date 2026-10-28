import Link from "next/link";
import { ASSETS } from "@/config/assets";

export default function NotFound() {
  return (
    <div className="fq-wrap py-20 text-center">
      <img src={ASSETS.lens} alt="" width={180} height={180} className="mx-auto h-44 w-44" />
      <h1 className="mt-6 text-[36px] font-light text-fg">This page is not here.</h1>
      <p className="fq-note mt-3">The address may have changed. Markets and the token search are one click away.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className="fq-btn arrow">
          Open markets
        </Link>
        <Link href="/compare" className="fq-btn quiet">
          Compare two markets
        </Link>
      </div>
    </div>
  );
}
