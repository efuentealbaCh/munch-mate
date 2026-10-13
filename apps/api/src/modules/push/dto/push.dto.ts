import { Type } from "class-transformer";
import { IsString, Length, MaxLength, ValidateNested } from "class-validator";

export class PushKeysDto {
  @IsString()
  @Length(10, 200)
  p256dh!: string;

  @IsString()
  @Length(10, 100)
  auth!: string;
}

/** `PushSubscription.toJSON()` from the browser. The endpoint host is checked against the push services. */
export class PushSubscriptionDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

export class PushEndpointDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;
}
