import type { Metadata } from "next";
import { TeamView } from "./team-view";

export const metadata: Metadata = { title: "Equipo" };

export default function TeamPage() {
  return <TeamView />;
}
