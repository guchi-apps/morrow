-- DropIndex
DROP INDEX `User_wakeTokenHash_key` ON `User`;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `briefingHour`,
    DROP COLUMN `briefingMinute`,
    DROP COLUMN `proactiveAvoidWork`,
    DROP COLUMN `proactiveCheckedAt`,
    DROP COLUMN `proactiveFrequency`,
    DROP COLUMN `proactiveFreeTime`,
    DROP COLUMN `proactiveOngoing`,
    DROP COLUMN `proactiveQuietEnd`,
    DROP COLUMN `proactiveQuietStart`,
    DROP COLUMN `proactiveWeekend`,
    DROP COLUMN `wakeTokenCreatedAt`,
    DROP COLUMN `wakeTokenHash`,
    DROP COLUMN `wakeTokenUsedAt`;
