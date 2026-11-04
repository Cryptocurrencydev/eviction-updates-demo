"use client";

import { FirmLog, PhoneFrame, usePhone } from "./Phone";

export function PhonesPanel() {
  const phone = usePhone();
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
      <PhoneFrame phone={phone} />
      <FirmLog data={phone.data} />
    </div>
  );
}
