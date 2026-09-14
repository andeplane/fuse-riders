/** Each view consumes only its own input acknowledgement; spectators consume none. */
export function recipientAcknowledgements(ack:Readonly<Record<string,number>>,recipient:string):Record<string,number> {
  return Object.hasOwn(ack,recipient)?{[recipient]:ack[recipient]!}:{};
}
