import { IsNumber, Max, Min } from "class-validator";

/** A point on the map. Shape only: the services check what the point means (zone, restaurant). */
export class GeoPointDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;
}
