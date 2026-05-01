// ================================================================
// DATABASE SEED — Initial data for development
// Creates: institution, admin user, RSA key pair, sample modules
// ================================================================
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // 1. Create default institution
  const institution = await prisma.institution.upsert({
    where: { domain: 'certiverify.com' },
    update: {},
    create: {
      name: 'CertiVerify Academy',
      domain: 'certiverify.com',
      isActive: true,
    },
  });
  console.log(`✅ Institution: ${institution.name} (${institution.id})`);

  // 2. Generate RSA-2048 key pair for the institution
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keyPair = await prisma.keyPair.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      institutionId: institution.id,
      publicKeyPem: publicKey,
      privateKeyRef: privateKey, // In prod: this would be a HSM reference
      algorithm: 'RSA-SHA256',
      keySize: 2048,
      isActive: true,
    },
  });
  console.log(`✅ RSA-2048 Key Pair generated (${keyPair.id})`);

  // 3. Create admin user (password: "admin123")
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@certiverify.com' },
    update: {},
    create: {
      email: 'admin@certiverify.com',
      passwordHash: adminPassword,
      fullName: 'Admin Principal',
      role: 'admin',
      institutionId: institution.id,
      isActive: true,
    },
  });
  console.log(`✅ Admin: ${admin.email} (password: admin123)`);

  // 4. Create sample student (password: "student123")
  const studentPassword = await bcrypt.hash('student123', 12);
  const student = await prisma.user.upsert({
    where: { email: 'jean@student.com' },
    update: {},
    create: {
      email: 'jean@student.com',
      passwordHash: studentPassword,
      fullName: 'Jean Dupont',
      role: 'student',
      institutionId: institution.id,
      isActive: true,
    },
  });
  console.log(`✅ Student: ${student.email} (password: student123)`);

  // 5. Create sample modules
  const modulesData = [
    { title: 'Fondamentaux de la Cybersécurité', description: 'Apprenez les bases de la protection des données et les principes de sécurité informatique.', creditHours: 40 },
    { title: 'Développement Web Moderne', description: 'Maîtrisez React, Node.js, et les architectures fullstack sécurisées.', creditHours: 60 },
    { title: 'Intelligence Artificielle', description: 'Introduction aux réseaux de neurones, machine learning et deep learning.', creditHours: 50 },
  ];

  for (const mod of modulesData) {
    const created = await prisma.module.upsert({
      where: { id: crypto.randomUUID() }, // Will always create since UUID is unique
      update: {},
      create: {
        ...mod,
        institutionId: institution.id,
        isActive: true,
      },
    });
    console.log(`✅ Module: ${created.title}`);
  }

  console.log('\n🎉 Seed complete!\n');
  console.log('─── Test Credentials ───');
  console.log('Admin:   admin@certiverify.com / admin123');
  console.log('Student: jean@student.com / student123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
