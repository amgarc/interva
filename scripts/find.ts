// Quick lookup by last name (optionally first name). Usage:
//   npx tsx scripts/find.ts <lastName> [firstName]
// Example: npx tsx scripts/find.ts Khayat Mamdouh

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [lastName, firstName] = process.argv.slice(2);
  if (!lastName) {
    console.error("Usage: npx tsx scripts/find.ts <lastName> [firstName]");
    process.exit(1);
  }

  const results = await prisma.physician.findMany({
    where: {
      lastName: { contains: lastName, mode: "insensitive" },
      ...(firstName && { firstName: { contains: firstName, mode: "insensitive" } }),
    },
    include: {
      taxonomies: { orderBy: { slot: "asc" } },
      addresses: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  if (results.length === 0) {
    console.log("No matches.");
    await prisma.$disconnect();
    return;
  }

  for (const p of results) {
    const name = [p.namePrefix, p.firstName, p.middleName, p.lastName, p.nameSuffix]
      .filter(Boolean)
      .join(" ");
    const creds = p.credentials ? `, ${p.credentials}` : "";
    console.log(`\n=== ${name}${creds}  (NPI ${p.npi}) ===`);
    console.log(
      `  sex=${p.gender ?? "?"}  enumerated=${p.enumerationDate?.toISOString().slice(0, 10) ?? "?"}  updated=${p.lastUpdatedDate?.toISOString().slice(0, 10) ?? "?"}  deactivated=${p.deactivationDate?.toISOString().slice(0, 10) ?? "no"}`,
    );

    console.log(`  Taxonomies:`);
    for (const t of p.taxonomies) {
      const pri = t.isPrimary ? " [PRIMARY]" : "";
      const lic = t.license ? `  lic=${t.license}/${t.licenseState ?? "?"}` : "";
      console.log(`    slot ${t.slot}: ${t.code}  ${t.name ?? ""}${pri}${lic}`);
    }

    console.log(`  Addresses:`);
    for (const a of p.addresses) {
      const addr = [a.line1, a.line2].filter(Boolean).join(", ");
      const loc = [a.city, a.state, a.postalCode].filter(Boolean).join(" ");
      console.log(`    ${a.kind}: ${addr}, ${loc}${a.phone ? `  ph ${a.phone}` : ""}${a.fax ? `  fx ${a.fax}` : ""}`);
    }
  }
  console.log();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
