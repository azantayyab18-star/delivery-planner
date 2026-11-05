-- Each route is planned for a vehicle (bike or van); existing routes were all planned for bikes.
CREATE TYPE "Vehicle" AS ENUM ('bike', 'van');
ALTER TABLE "routes" ADD COLUMN "vehicle" "Vehicle" NOT NULL DEFAULT 'bike';
