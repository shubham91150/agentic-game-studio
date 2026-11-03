using UnityEngine;

public class AgenticPlayerController : MonoBehaviour
{
    public float speed = 10f;
    public float jumpVelocity = 9f;
    public float gravity = -12f;

    private Vector3 velocity;
    private bool isGrounded;

    private void Update()
    {
        float horizontal = 0f;
        float vertical = 0f;

        if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow))
        {
            vertical += 1f;
        }

        if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow))
        {
            vertical -= 1f;
        }

        if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow))
        {
            horizontal -= 1f;
        }

        if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow))
        {
            horizontal += 1f;
        }

        Vector3 move = new Vector3(horizontal, 0f, vertical);
        if (move.magnitude > 1f)
        {
            move.Normalize();
        }

        transform.Translate(move * speed * Time.deltaTime, Space.World);

        isGrounded = transform.position.y <= 0f;
        if (isGrounded && velocity.y < 0f)
        {
            velocity.y = 0f;
            Vector3 groundedPosition = transform.position;
            groundedPosition.y = 0f;
            transform.position = groundedPosition;
        }

        if (isGrounded && Input.GetKeyDown(KeyCode.Space))
        {
            velocity.y = jumpVelocity;
        }

        velocity.y += gravity * Time.deltaTime;
        transform.Translate(new Vector3(0f, velocity.y, 0f) * Time.deltaTime, Space.World);

        if (transform.position.y < 0f)
        {
            Vector3 clampedPosition = transform.position;
            clampedPosition.y = 0f;
            transform.position = clampedPosition;
            velocity.y = 0f;
        }
    }
}
