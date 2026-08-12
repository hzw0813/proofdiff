def send_receipt(client, address, message, retries=2):
    for attempt in range(retries + 1):
        try:
            return client.send(address, message)
        except TimeoutError:
            if attempt == retries:
                raise
