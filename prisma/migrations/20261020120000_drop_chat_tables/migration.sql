-- DropForeignKey
ALTER TABLE `Conversation` DROP FOREIGN KEY `Conversation_userId_fkey`;

-- DropForeignKey
ALTER TABLE `ContextBreak` DROP FOREIGN KEY `ContextBreak_conversationId_fkey`;

-- DropForeignKey
ALTER TABLE `Message` DROP FOREIGN KEY `Message_conversationId_fkey`;

-- DropForeignKey
ALTER TABLE `ApiUsage` DROP FOREIGN KEY `ApiUsage_conversationId_fkey`;

-- DropForeignKey
ALTER TABLE `ToolCall` DROP FOREIGN KEY `ToolCall_userId_fkey`;

-- DropForeignKey
ALTER TABLE `ToolCall` DROP FOREIGN KEY `ToolCall_conversationId_fkey`;

-- DropForeignKey
ALTER TABLE `Memory` DROP FOREIGN KEY `Memory_userId_fkey`;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `homeProfile`,
    DROP COLUMN `homeProfileFetchedAt`;

-- AlterTable
ALTER TABLE `ApiUsage` DROP COLUMN `conversationId`;

-- AlterTable
ALTER TABLE `NotificationLog` DROP COLUMN `conversationId`;

-- DropTable
DROP TABLE `Conversation`;

-- DropTable
DROP TABLE `ContextBreak`;

-- DropTable
DROP TABLE `Message`;

-- DropTable
DROP TABLE `ToolCall`;

-- DropTable
DROP TABLE `Memory`;

