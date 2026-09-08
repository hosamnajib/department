-- ============================================================
-- MySQL Database Schema for Department & Supervisor Directory
-- Database: department_db
-- ============================================================

-- 1. Create Database if not exists
CREATE DATABASE IF NOT EXISTS `department_db` 
  DEFAULT CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE `department_db`;

-- 2. Drop existing tables if re-initializing (Order matters due to Foreign Key constraint)
DROP TABLE IF EXISTS `departments`;
DROP TABLE IF EXISTS `supervisors`;

-- 3. Create Supervisors Table
CREATE TABLE `supervisors` (
  `id` VARCHAR(20) NOT NULL,
  `firstName` VARCHAR(100) NOT NULL,
  `lastName` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'Active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create Departments Table (Referencing Supervisors Table)
CREATE TABLE `departments` (
  `id` VARCHAR(20) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `supervisorId` VARCHAR(20) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'Active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_supervisor_id` (`supervisorId`),
  CONSTRAINT `fk_dept_supervisor` 
    FOREIGN KEY (`supervisorId`) 
    REFERENCES `supervisors` (`id`) 
    ON DELETE SET NULL 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Sample Initial Data Seed
-- ============================================================

-- Seed Supervisors
INSERT INTO `supervisors` (`id`, `firstName`, `lastName`, `email`, `status`) VALUES
('SUP-0007', 'Tauedea', 'Gabi', 'gabitautau@gmail.com', 'Active'),
('SUP-0008', 'Krisha', 'Lama', 'krilam@gmail.com', 'Active'),
('SUP-0003', 'Daniel', 'Lee', 'daniel.lee@example.com', 'Active'),
('SUP-0002', 'Aisyah', 'Rahman', 'aisyah.rahman@example.com', 'Active'),
('SUP-0001', 'Wei Jie', 'Tan', 'weijie.tan@example.com', 'Active');

-- Seed Departments
INSERT INTO `departments` (`id`, `name`, `supervisorId`, `status`) VALUES
('DEP-0001', 'Software engineering', 'SUP-0007', 'Active'),
('DEP-0002', 'Human Resources', 'SUP-0008', 'Active'),
('DEP-0003', 'Marketing', 'SUP-0003', 'Active'),
('DEP-0004', 'Business Data & Analysis', 'SUP-0001', 'Active'),
('DEP-0005', 'Product & UX Design', 'SUP-0002', 'Active');
