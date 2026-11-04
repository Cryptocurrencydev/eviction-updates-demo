import { PhonesPanel } from "@/components/PhonesPanel";

export default function PhonesPage() {
  return (
    <>
      <h1 className="font-serif text-2xl text-plum-900">Phones</h1>
      <p className="mb-4 text-sm text-muted">The same conversation from both ends. Texts are simulated: nothing leaves this demo.</p>
      <PhonesPanel />
    </>
  );
}
