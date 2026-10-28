using UnityEngine;

public class AgenticPlayerController : MonoBehaviour
{
    public float speed = 14f;
    public float jumpVelocity = 9.5f;
    public float gravity = -16f;

    private Vector3 velocity;
    private bool isGrounded;

    private void Update()
    {
        float moveX = Input.GetAxis("Horizontal");
        float moveZ = Input.GetAxis("Vertical");

        Vector3 move = new Vector3(moveX, 0f, moveZ) * speed;
        move = transform.TransformDirection(move);

        if (isGrounded && velocity.y < 0f)
        {
            velocity.y = -1f;
        }

        if (isGrounded && Input.GetKeyDown(KeyCode.Space))
        {
            velocity.y = jumpVelocity;
            isGrounded = false;
        }

        velocity.y += gravity * Time.deltaTime;

        Vector3 motion = (move + new Vector3(0f, velocity.y, 0f)) * Time.deltaTime;
        transform.position += motion;

        if (transform.position.y <= 0f)
        {
            transform.position = new Vector3(transform.position.x, 0f, transform.position.z);
            velocity.y = 0f;
            isGrounded = true;
        }
    }
}
