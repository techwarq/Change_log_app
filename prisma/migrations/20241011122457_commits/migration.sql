/*
  Warnings:

  - You are about to drop the column `timestamp` on the `Commit` table. All the data in the column will be lost.
  - Added the required column `date` to the `Commit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `repoFullName` to the `Commit` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Commit" DROP COLUMN "timestamp",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "repoFullName" TEXT NOT NULL;
