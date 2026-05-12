// ================================================================
// DATABASE SEED — Initial data for development
// Creates: institution, admin user, RSA key pair, sample modules
// ================================================================
import 'dotenv/config';
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

  // 3. Create admin user — FIX faille #4: mot de passe aléatoire fort
  const adminTempPass = crypto.randomBytes(16).toString('base64url');
  const adminPassword = await bcrypt.hash(adminTempPass, 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@certiverify.com' },
    update: {
      passwordHash: adminPassword,
      fullName: 'Admin Principal',
      role: 'admin',
      institutionId: institution.id,
      isActive: true,
    },
    create: {
      email: 'admin@certiverify.com',
      passwordHash: adminPassword,
      fullName: 'Admin Principal',
      role: 'admin',
      institutionId: institution.id,
      isActive: true,
    },
  });
  console.log(`✅ Admin: ${admin.email}`);
  console.log(`   🔑 Mot de passe temporaire admin: ${adminTempPass}`);
  console.log('   ⚠️  CHANGER CE MOT DE PASSE APRÈS CONNEXION !');

  // 4. Create sample student — FIX faille #4: mot de passe aléatoire fort
  const studentTempPass = crypto.randomBytes(16).toString('base64url');
  const studentPassword = await bcrypt.hash(studentTempPass, 12);
  const student = await prisma.user.upsert({
    where: { email: 'jean@student.com' },
    update: {
      passwordHash: studentPassword,
      fullName: 'Jean Dupont',
      role: 'student',
      institutionId: institution.id,
      isActive: true,
    },
    create: {
      email: 'jean@student.com',
      passwordHash: studentPassword,
      fullName: 'Jean Dupont',
      role: 'student',
      institutionId: institution.id,
      isActive: true,
    },
  });
  console.log(`✅ Student: ${student.email}`);
  console.log(`   🔑 Mot de passe temporaire étudiant: ${studentTempPass}`);
  console.log('   ⚠️  CHANGER CE MOT DE PASSE APRÈS CONNEXION !');

  // 5. Create sample modules
  const modulesData = [
    { title: 'Fondamentaux de la Cybersécurité', description: 'Apprenez les bases de la protection des données et les principes de sécurité informatique.', creditHours: 40 },
    { title: 'Développement Web Moderne', description: 'Maîtrisez React, Node.js, et les architectures fullstack sécurisées.', creditHours: 60 },
    { title: 'Intelligence Artificielle', description: 'Introduction aux réseaux de neurones, machine learning et deep learning.', creditHours: 50 },
  ];

  const createdModules: string[] = [];
  for (const mod of modulesData) {
    const created = await prisma.module.create({
      data: {
        ...mod,
        institutionId: institution.id,
        isActive: true,
      },
    });
    createdModules.push(created.id);
    console.log(`✅ Module: ${created.title}`);
  }

  // 6. Enroll student in all modules, complete 2 of 3
  for (let i = 0; i < createdModules.length; i++) {
    await prisma.userModule.create({
      data: {
        userId: student.id,
        moduleId: createdModules[i],
        status: i < 2 ? 'completed' : 'enrolled', // First 2 completed, last enrolled
        completedAt: i < 2 ? new Date() : null,
      },
    });
  }
  console.log(`✅ Student enrolled in ${createdModules.length} modules (${2} completed)`);

  console.log('\n🎉 Seed complete!\n');
  console.log('─── Comptes de test créés — Mots de passe affichés ci-dessus —───');
  console.log('Admin:   admin@certiverify.com');
  console.log('Student: jean@student.com');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
