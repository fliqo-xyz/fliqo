import { HomeView } from "@/components/home/HomeView";
import { JsonLd } from "@/components/JsonLd";
import { appLd } from "@/lib/seo";

export default function Home() {
  return (
    <>
      <JsonLd data={appLd} />
      <HomeView />
    </>
  );
}
